import type { Hono } from "jsr:@hono/hono";
import { paymentsEnabled } from "../lib/flags.ts";
import type { Ctx, Variables } from "../index.ts";

// Access decisions are cached per user+book with ASYMMETRIC TTLs:
//   - denials ("0") expire after 5s — a user who pays mid-session is unlocked
//     on their next retry instead of being LOCKED for up to a minute;
//   - allows ("1") live 60s to keep the hot path cheap (after a refund the
//     stale access is bounded to 60s).
//
// Redis invalidation plan (when the Cache seam grows a shared backend, per
// plan_03_api.md "memory impl (Redis later, same interface)"): on webhook
// grant/revoke, delete `ent:{app_user_id}:{book_id}` — or, to avoid wildcard
// scans, stamp a per-user entitlements_version into the key and bump the
// counter in apply_revenue_event's transaction. Per-isolate MemoryCache cannot
// be invalidated cross-isolate, which is exactly why the bounded TTLs remain
// the safety net even after the shared cache lands.
const ACCESS_ALLOW_TTL_SEC = 60;
const ACCESS_DENY_TTL_SEC = 5;

export function registerBundleRoute(api: Hono<{ Variables: Variables }>): void {
  api.get("/books/:id/bundle", async (c) => {
    const ctx = c.get("ctx") as Ctx;
    // Book metadata and the payments flag are independent reads: start them
    // concurrently so the gate pays one serial latency stage instead of two
    // (review P2-2). The flag read is TTL-cached, so on the hot path it
    // resolves locally; on the 404 path the speculative read is wasted but
    // harmless.
    const [book, payments] = await Promise.all([
      ctx.db.getBook(c.req.param("id")),
      paymentsEnabled({ db: ctx.db, env: ctx.env, cache: ctx.cache }),
    ]);
    if (!book || book.status !== "published" || book.bundle_url === "") {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "book not found" } }, 404);
    }

    if (payments) {
      const allowed = await cachedAccess(ctx, c.get("uid"), book.id);
      if (!allowed) return c.json({ ok: false, error: { code: "LOCKED", message: "book is locked" } }, 403);
    }

    const etag = `"v${book.bundle_version}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-store" };
    if (matchesEtag(c.req.header("if-none-match"), etag)) return new Response(null, { status: 304, headers });
    return new Response(null, { status: 302, headers: { ...headers, Location: book.bundle_url } });
  });
}

async function cachedAccess(ctx: Ctx, appUserId: string, bookId: string): Promise<boolean> {
  const cacheKey = `ent:${appUserId}:${bookId}`;
  const cached = await ctx.cache.get(cacheKey);
  if (cached === "1") return true;
  if (cached === "0") return false;

  const access = await ctx.db.checkAccess(appUserId, [bookId]);
  const allowed = access.claimedBookIds.includes(bookId) || access.entitledBookIds.includes(bookId);
  await ctx.cache.set(cacheKey, allowed ? "1" : "0", allowed ? ACCESS_ALLOW_TTL_SEC : ACCESS_DENY_TTL_SEC);
  return allowed;
}

function matchesEtag(header: string | undefined, current: string): boolean {
  if (header === undefined) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === current || value === `W/${current}`;
  });
}
