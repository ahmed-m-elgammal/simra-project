import type { Hono } from "jsr:@hono/hono";
import { paymentsEnabled } from "../lib/flags.ts";
import type { Ctx, Variables } from "../index.ts";

const ACCESS_CACHE_TTL_SEC = 60;

export function registerBundleRoute(api: Hono<{ Variables: Variables }>): void {
  api.get("/books/:id/bundle", async (c) => {
    const ctx = c.get("ctx") as Ctx;
    const book = await ctx.db.getBook(c.req.param("id"));
    if (!book || book.status !== "published" || book.bundle_url === "") {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "book not found" } }, 404);
    }

    if (await paymentsEnabled({ db: ctx.db, env: ctx.env })) {
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
  await ctx.cache.set(cacheKey, allowed ? "1" : "0", ACCESS_CACHE_TTL_SEC);
  return allowed;
}

function matchesEtag(header: string | undefined, current: string): boolean {
  if (header === undefined) return false;
  return header.split(",").some((candidate) => {
    const value = candidate.trim();
    return value === "*" || value === current || value === `W/${current}`;
  });
}
