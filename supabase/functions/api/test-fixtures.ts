import { MemoryCache } from "./lib/cache.ts";
import { FakeDb, type BookRecord } from "./lib/db.ts";
import type { Ctx } from "./index.ts";

// Test-only data. Production requests use SupabaseDb and never import this file.
export const minibookFixture: readonly BookRecord[] = [{
  id: "habits",
  title: "The Habit Loop",
  description: "A short simulation about building habits.",
  status: "published",
  bundle_version: 1,
  bundle_url: "bundles/bundle-habits-en-v1.json",
}];

export const devClaimFixtures = [
  { appUserId: "u_free", bookId: "a" },
  { appUserId: "u_free", bookId: "b" },
  { appUserId: "u_free", bookId: "c" },
];

export const devEntitlementFixtures = [{ appUserId: "u_ent", bookId: "habits" }];

export function seededDb(flags: Record<string, unknown> = {}): FakeDb {
  return new FakeDb(flags, {
    books: minibookFixture,
    claims: devClaimFixtures,
    entitlements: devEntitlementFixtures,
  });
}

export function context(flags: Record<string, unknown> = {}, env: Record<string, string> = {}, db = seededDb(flags)): Ctx {
  return { db, cache: new MemoryCache(), env: { REVENUECAT_WEBHOOK_SECRET: "test_rc_secret", ...env } };
}

