import type { Hono } from "jsr:@hono/hono";
import { timingSafeEqual } from "jsr:@std/crypto/timing-safe-equal";
import type { RevenueEventAction } from "../lib/db-types.ts";
import type { Ctx, Variables } from "../index.ts";

async function verifyWebhookSecret(authHeader: string | undefined, expectedSecret: string): Promise<boolean> {
  if (!authHeader || !expectedSecret) return false;
  if (!authHeader.startsWith("Bearer ")) return false;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return false;

  const encoder = new TextEncoder();
  const [tokenDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(token)),
    crypto.subtle.digest("SHA-256", encoder.encode(expectedSecret)),
  ]);
  return timingSafeEqual(new Uint8Array(tokenDigest), new Uint8Array(expectedDigest));
}


function extractTargetBookId(record: Record<string, unknown>, eventObj?: Record<string, unknown>): string | null {
  const directBookId = typeof eventObj?.book_id === "string" ? eventObj.book_id.trim() :
    typeof record.book_id === "string" ? record.book_id.trim() : undefined;

  const entitlementId = typeof eventObj?.entitlement_id === "string" ? eventObj.entitlement_id.trim() :
    typeof record.entitlement_id === "string" ? record.entitlement_id.trim() :
    typeof eventObj?.entitlement === "string" ? eventObj.entitlement.trim() :
    typeof record.entitlement === "string" ? record.entitlement.trim() : undefined;

  const rawList = eventObj?.entitlement_ids ?? record.entitlement_ids;
  const entitlementIds = Array.isArray(rawList)
    ? rawList.filter((item): item is string => typeof item === "string").map((s) => s.trim())
    : [];

  // Decision locked: entitlements table gains row (uid, '*') meaning all-books;
  // checkAccess treats '*' as unlock-all. Storing one row per book is intentionally avoided.
  if (
    directBookId === "*" ||
    directBookId === "all_books" ||
    entitlementId === "all_books" ||
    entitlementIds.includes("all_books")
  ) {
    return "*";
  }

  if (directBookId && directBookId.length > 0) return directBookId;
  if (entitlementId && entitlementId.length > 0) return entitlementId;
  if (entitlementIds.length > 0 && entitlementIds[0].length > 0) return entitlementIds[0];

  return null;
}

function classifyAction(rawType: string): RevenueEventAction {
  const normalized = rawType.trim().toUpperCase();
  if (
    normalized === "PURCHASE" ||
    normalized === "INITIAL_PURCHASE" ||
    normalized === "RENEWAL" ||
    normalized === "NON_RENEWING_PURCHASE" ||
    normalized === "PRODUCT_CHANGE" ||
    normalized === "UNCANCELLATION"
  ) {
    return "grant";
  }
  if (
    normalized === "CANCELLATION" ||
    normalized === "REFUND" ||
    normalized === "EXPIRATION" ||
    normalized === "EXPIRY" ||
    normalized === "BILLING_ISSUE"
  ) {
    return "revoke";
  }
  return "none";
}

export function registerWebhookRoute(api: Hono<{ Variables: Variables }>): void {
  api.post("/webhooks/revenuecat", async (c) => {
    const ctx = c.get("ctx") as Ctx;
    const expectedSecret = ctx.env.REVENUECAT_WEBHOOK_SECRET ?? "";
    const authorized = await verifyWebhookSecret(c.req.header("authorization"), expectedSecret);
    if (!authorized) {
      return c.json({ ok: false, error: { code: "INVALID", message: "invalid authorization" } }, 401);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { code: "INVALID", message: "invalid json body" } }, 400);
    }

    if (body === null || typeof body !== "object") {
      return c.json({ ok: false, error: { code: "INVALID", message: "invalid payload" } }, 400);
    }

    const record = body as Record<string, unknown>;
    const eventObj = record.event !== null && typeof record.event === "object"
      ? (record.event as Record<string, unknown>)
      : undefined;

    const rawEventId = eventObj?.id ?? eventObj?.event_id ?? record.event_id ?? record.id;
    const rawAppUserId = eventObj?.app_user_id ?? record.app_user_id;
    const rawType = eventObj?.type ?? record.type;

    if (
      typeof rawEventId !== "string" || !rawEventId.trim() ||
      typeof rawAppUserId !== "string" || !rawAppUserId.trim() ||
      typeof rawType !== "string" || !rawType.trim()
    ) {
      return c.json({ ok: false, error: { code: "INVALID", message: "missing required event fields" } }, 400);
    }

    const eventId = rawEventId.trim();
    const appUserId = rawAppUserId.trim();
    const eventType = rawType.trim();
    const action = classifyAction(eventType);
    const targetBookId = extractTargetBookId(record, eventObj);

    if (action !== "none" && !targetBookId) {
      return c.json({ ok: false, error: { code: "INVALID", message: "missing book_id or entitlement" } }, 400);
    }

    // Atomic apply (migration 004): the security-definer RPC records the
    // idempotency marker and applies grant/revoke in ONE transaction. A
    // transient failure now rolls back both, so RevenueCat's retry cleanly
    // re-applies instead of hitting a committed marker and silently dropping
    // the event's effect.
    await ctx.db.applyRevenueEvent(
      { eventId, appUserId, bookId: targetBookId ?? "", type: eventType },
      action,
    );

    return c.json({ ok: true }, 200);
  });
}
