import type { Hono } from "jsr:@hono/hono";
import { paymentsEnabled } from "../lib/flags.ts";
import type { Ctx, Variables } from "../index.ts";

export function registerClaimRoute(api: Hono<{ Variables: Variables }>): void {
  api.post("/books/:id/claim-free", async (c) => {
    const ctx = c.get("ctx") as Ctx;
    const enforceLimit = await paymentsEnabled({ db: ctx.db, env: ctx.env, cache: ctx.cache });
    const result = await ctx.db.claimFree(c.get("uid"), c.req.param("id"), { enforceLimit });
    if (result.status === "not_found") {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "book not found" } }, 404);
    }
    if (result.status === "limit_reached") {
      return c.json({ ok: false, error: { code: "LIMIT_REACHED", message: "free claim limit reached", remaining: 0 } }, 409);
    }
    if (!enforceLimit) return c.json({ ok: true, claimed: true, remaining: 3, monitor_only: true }, 200);
    return c.json({ ok: true, claimed: true, remaining: result.remaining }, 200);
  });
}
