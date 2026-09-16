import type { Hono } from "jsr:@hono/hono";
import type { Variables } from "../index.ts";

export function registerRequestsRoute(api: Hono<{ Variables: Variables }>) {
  api.post("/requests", async (c) => {
    const uid = c.get("uid");
    const { db } = c.get("ctx");

    const premium = await db.isPremium(uid);
    if (!premium) {
      return c.json({ ok: false, error: { code: "LOCKED", message: "Premium required to submit book requests" } }, 403);
    }

    let body: { requested_title?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { code: "INVALID", message: "Invalid JSON body" } }, 400);
    }

    const title = typeof body.requested_title === "string" ? body.requested_title.trim() : "";
    if (title.length < 1 || title.length > 200) {
      return c.json({ ok: false, error: { code: "INVALID", message: "Title must be between 1 and 200 characters" } }, 400);
    }

    const sevenDaysSeconds = 7 * 24 * 60 * 60;
    const recentCount = await db.countRecentRequests(uid, sevenDaysSeconds);
    if (recentCount >= 1) {
      return c.json({ ok: false, error: { code: "RATE_LIMITED", message: "Limit of 1 request per 7 days" } }, 429);
    }

    await db.createRequest(uid, title);
    return c.json({ ok: true });
  });
}
