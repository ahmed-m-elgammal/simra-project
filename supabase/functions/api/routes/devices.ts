import type { Hono } from "jsr:@hono/hono";
import type { Ctx, Variables } from "../index.ts";

const PLATFORMS = new Set(["ios", "android"]);

export function registerDevicesRoute(api: Hono<{ Variables: Variables }>): void {
  api.post("/devices/register", async (c) => {
    const ctx = c.get("ctx") as Ctx;
    let body: { platform?: unknown; token?: unknown; locale?: unknown } = {};
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { code: "INVALID", message: "invalid json body" } }, 400);
    }

    const platform = typeof body.platform === "string" ? body.platform.trim().toLowerCase() : "";
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const locale = typeof body.locale === "string" && body.locale.trim() !== "" ? body.locale.trim() : undefined;

    if (!token) {
      return c.json({ ok: false, error: { code: "INVALID", message: "token is required" } }, 400);
    }
    if (!PLATFORMS.has(platform)) {
      return c.json({ ok: false, error: { code: "INVALID", message: "platform must be ios or android" } }, 400);
    }

    // Upsert by token PK: a device re-registering (e.g. after login switch) moves to the new user.
    await ctx.db.registerDevice(c.get("uid"), platform, token, locale);
    return c.json({ ok: true }, 200);
  });

  api.delete("/devices/:token", async (c) => {
    const ctx = c.get("ctx") as Ctx;
    // Best-effort unregister per plan: unknown tokens still resolve 200.
    await ctx.db.unregisterDevice(c.req.param("token"));
    return c.json({ ok: true }, 200);
  });
}
