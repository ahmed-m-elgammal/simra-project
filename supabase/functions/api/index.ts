import { Hono } from "jsr:@hono/hono";
import { MemoryCache, type Cache } from "./lib/cache.ts";
import { SupabaseDb, type Db } from "./lib/db.ts";
import { registerAccountRoute } from "./routes/account.ts";
import { registerBundleRoute } from "./routes/bundle.ts";
import { registerCatalogRoute } from "./routes/catalog.ts";
import { registerClaimRoute } from "./routes/claim.ts";
import { registerDevicesRoute } from "./routes/devices.ts";
import { registerRequestsRoute } from "./routes/requests.ts";
import { registerWebhookRoute } from "./routes/webhook.ts";

export interface Ctx {
  db: Db;
  cache: Cache;
  env: Record<string, string>;
}

export interface Variables {
  uid: string;
  ctx: Ctx;
}

const productionCache = new MemoryCache();

function productionContext(): Ctx {
  return {
    db: new SupabaseDb(),
    cache: productionCache,
    env: {
      PAYMENTS_ENABLED: Deno.env.get("PAYMENTS_ENABLED") ?? "false",
      REVENUECAT_WEBHOOK_SECRET: Deno.env.get("REVENUECAT_WEBHOOK_SECRET") ?? "",
    },
  };
}

export function app(ctx: Ctx) {
  const api = new Hono<{ Variables: Variables }>();

  api.use("*", async (c, next) => {
    const headerUid = c.req.header("x-app-user-id")?.trim();
    const queryUid = c.req.query("app_user_id")?.trim();
    const uid = headerUid || queryUid;
    if (!uid && !c.req.path.startsWith("/webhooks/")) {
      return c.json({ ok: false, error: { code: "INVALID", message: "missing app_user_id" } }, 400);
    }
    c.set("uid", uid ?? "");
    c.set("ctx", ctx);
    await next();
  });

  registerCatalogRoute(api);
  registerClaimRoute(api);
  registerBundleRoute(api);
  registerWebhookRoute(api);
  registerAccountRoute(api);
  registerRequestsRoute(api);
  registerDevicesRoute(api);

  api.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "no such route" } }, 404));
  api.onError((error, c) => c.json({ ok: false, error: { code: "ABORTED", message: String(error?.message ?? error) } }, 500));
  return api;
}

export default { fetch: (request: Request) => app(productionContext()).fetch(request) };
