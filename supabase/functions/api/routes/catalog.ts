import type { Hono } from "jsr:@hono/hono";
import { paymentsEnabled } from "../lib/flags.ts";
import type { BookRecord } from "../lib/db.ts";
import type { Ctx, Variables } from "../index.ts";

const BOOKS_CACHE_KEY = "books:published";
const BOOKS_CACHE_TTL_SEC = 60;

type PriceTier = "free_eligible" | "paid";

interface CatalogBook {
  id: string;
  title: string;
  description: string;
  price_tier: PriceTier;
  unlocked_for_me: boolean;
  bundle_version: number;
  has_update: boolean;
}

export function registerCatalogRoute(api: Hono<{ Variables: Variables }>): void {
  api.get("/catalog", async (c) => {
    const ctx = c.get("ctx") as Ctx;
    const known = parseKnownVersions(c.req.query("known"));
    if (known instanceof Response) return known;

    // Books metadata and the payments flag are independent reads → fetch
    // them together. In Phase 0 (payments off) every book is unlocked and
    // price_tier is constant, so the per-user access query is skipped
    // entirely instead of paying two wasted GETs per request (review P2-3).
    const [books, payments] = await Promise.all([
      cachedBooks(ctx),
      paymentsEnabled({ db: ctx.db, env: ctx.env, cache: ctx.cache }),
    ]);
    const access = payments ? await ctx.db.checkAccess(c.get("uid"), books.map((book) => book.id)) : null;
    const claimed = new Set(access?.claimedBookIds ?? []);
    const entitled = new Set(access?.entitledBookIds ?? []);
    const response: CatalogBook[] = books.map((book) => {
      const unlocked = !payments || claimed.has(book.id) || entitled.has(book.id);
      const knownVersion = known.get(book.id);
      return {
        id: book.id,
        title: book.title,
        description: book.description,
        price_tier: payments && !unlocked && (access?.freeClaimCount ?? 0) < 3 ? "free_eligible" : "paid",
        unlocked_for_me: unlocked,
        bundle_version: book.bundle_version,
        has_update: knownVersion !== undefined && knownVersion < book.bundle_version,
      };
    });
    return c.json({ ok: true, books: response }, 200);
  });
}

async function cachedBooks(ctx: Ctx): Promise<readonly BookRecord[]> {
  const cached = await ctx.cache.get(BOOKS_CACHE_KEY);
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached) as unknown;
      if (Array.isArray(parsed)) return parsed as BookRecord[];
    } catch {
      // A corrupt cache entry is a miss; the database remains the source of truth.
    }
  }
  const books = await ctx.db.listBooks();
  await ctx.cache.set(BOOKS_CACHE_KEY, JSON.stringify(books), BOOKS_CACHE_TTL_SEC);
  return books;
}

function parseKnownVersions(raw: string | undefined): Map<string, number> | Response {
  const known = new Map<string, number>();
  if (raw === undefined || raw.trim() === "") return known;
  for (const item of raw.split(",")) {
    const separator = item.lastIndexOf(":");
    const bookId = item.slice(0, separator).trim();
    const versionText = item.slice(separator + 1).trim();
    const version = Number(versionText);
    if (separator <= 0 || !/^\d+$/.test(versionText) || !Number.isSafeInteger(version)) {
      return new Response(JSON.stringify({ ok: false, error: { code: "INVALID", message: "known versions must use book:version" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    known.set(bookId, version);
  }
  return known;
}
