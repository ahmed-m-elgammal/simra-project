import type { Cache } from "./cache.ts";
import type { Db } from "./db.ts";

export interface FlagContext {
  db: Pick<Db, "getFlags">;
  env: Readonly<Record<string, string | undefined>>;
  /** Optional TTL cache; production passes the shared per-isolate cache. */
  cache?: Cache;
}

// Flags gate every /catalog, /claim-free and /bundle request, but the record
// changes at kill-switch cadence. Caching the raw database record for a
// bounded minute — the same staleness budget the plan already accepts for the
// published-books list and access decisions — removes a per-request round
// trip from the hot path (review P2-1). Only the DB record is cached: the
// environment fallback is re-evaluated on every call, so a cold cache still
// boots from PAYMENTS_ENABLED. When the Cache seam grows a shared Redis
// backend, kill-switch convergence can go instant by deleting `flags:all`
// from the admin path; until then the TTL bounds flag staleness to 60s.
const FLAGS_CACHE_KEY = "flags:all";
const FLAGS_CACHE_TTL_SEC = 60;

export async function loadFlags(ctx: FlagContext): Promise<Record<string, unknown>> {
  if (!ctx.cache) return ctx.db.getFlags();
  const cached = await ctx.cache.get(FLAGS_CACHE_KEY);
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // A corrupt cache entry is a miss; the database remains the source of truth.
    }
  }
  const flags = await ctx.db.getFlags();
  await ctx.cache.set(FLAGS_CACHE_KEY, JSON.stringify(flags), FLAGS_CACHE_TTL_SEC);
  return flags;
}

export async function paymentsEnabled(ctx: FlagContext): Promise<boolean> {
  const flags = await loadFlags(ctx);
  const override = flags.payments_enabled;
  if (typeof override === "boolean") return override;
  return ctx.env.PAYMENTS_ENABLED === "true";
}
