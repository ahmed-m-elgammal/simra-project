import { assertEquals } from "jsr:@std/assert";
import { app } from "./index.ts";
import { MemoryCache } from "./lib/cache.ts";
import { FakeDb } from "./lib/db.ts";
import { paymentsEnabled } from "./lib/flags.ts";
import { context, seededDb } from "./test-fixtures.ts";

Deno.test("FakeDb does not preload application content", async () => {
  assertEquals(await new FakeDb().listBooks(), []);
});

Deno.test("unknown route → NOT_FOUND envelope", async () => {
  const res = await app(context()).request("/nope", { headers: { "x-app-user-id": "u_test" } });
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("missing app_user_id → INVALID", async () => {
  const res = await app(context()).request("/catalog");
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "INVALID");
});

Deno.test("webhook paths bypass app_user_id middleware", async () => {
  const res = await app(context()).request("/webhooks/revenuecat");
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("payments flag defaults to false", async () => {
  assertEquals(await paymentsEnabled({ db: new FakeDb(), env: {} }), false);
});

Deno.test("payments flag reads the environment when DB has no override", async () => {
  assertEquals(await paymentsEnabled({ db: new FakeDb(), env: { PAYMENTS_ENABLED: "true" } }), true);
});

Deno.test("payments flag prefers the database override", async () => {
  assertEquals(await paymentsEnabled({ db: new FakeDb({ payments_enabled: false }), env: { PAYMENTS_ENABLED: "true" } }), false);
  assertEquals(await paymentsEnabled({ db: new FakeDb({ payments_enabled: true }), env: { PAYMENTS_ENABLED: "false" } }), true);
});

Deno.test("memory cache stores values and expires them by TTL", async () => {
  const cache = new MemoryCache();
  await cache.set("live", "value", 60);
  assertEquals(await cache.get("live"), "value");
  await cache.set("expired", "value", 0);
  assertEquals(await cache.get("expired"), null);
});

Deno.test("catalog returns the seeded book unlocked in phase 0", async () => {
  const res = await app(context()).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(body.books, [{
    id: "habits",
    title: "The Habit Loop",
    description: "A short simulation about building habits.",
    price_tier: "paid",
    unlocked_for_me: true,
    bundle_version: 1,
    has_update: false,
  }]);
});

Deno.test("catalog marks an unclaimed book free-eligible when payments are enabled", async () => {
  const res = await app(context({ payments_enabled: true })).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  const body = await res.json();
  assertEquals(body.books[0].price_tier, "free_eligible");
  assertEquals(body.books[0].unlocked_for_me, false);
});

Deno.test("catalog uses known versions to report updates and caches the published list", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const first = await app(ctx).request("/catalog?known=habits:0", { headers: { "x-app-user-id": "u_fresh" } });
  const second = await app(ctx).request("/catalog?known=habits:1", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals((await first.json()).books[0].has_update, true);
  assertEquals((await second.json()).books[0].has_update, false);
  assertEquals(db.listBooksCalls, 1);
});

Deno.test("phase 0 claim logs demand data without enforcing the limit", async () => {
  const db = seededDb();
  const res = await app(context({}, {}, db)).request("/books/habits/claim-free", {
    method: "POST",
    headers: { "x-app-user-id": "u_free", "content-type": "application/json" },
    body: "{}",
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, claimed: true, remaining: 3, monitor_only: true });
  assertEquals(db.hasClaim("u_free", "habits"), true);
});

Deno.test("payments-enabled claim limit returns LIMIT_REACHED for the fourth book", async () => {
  const db = seededDb({ payments_enabled: true });
  const res = await app(context({}, {}, db)).request("/books/habits/claim-free", {
    method: "POST",
    headers: { "x-app-user-id": "u_free", "content-type": "application/json" },
    body: "{}",
  });
  assertEquals(res.status, 409);
  assertEquals(await res.json(), {
    ok: false,
    error: { code: "LIMIT_REACHED", message: "free claim limit reached", remaining: 0 },
  });
  assertEquals(db.hasClaim("u_free", "habits"), false);
});

Deno.test("free claim is idempotent for an already-claimed book", async () => {
  const db = seededDb({ payments_enabled: true });
  const request = () => app(context({}, {}, db)).request("/books/habits/claim-free", {
    method: "POST",
    headers: { "x-app-user-id": "u_ent", "content-type": "application/json" },
    body: "{}",
  });
  const first = await request();
  const second = await request();
  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  assertEquals(await first.json(), { ok: true, claimed: true, remaining: 2 });
  assertEquals(await second.json(), { ok: true, claimed: true, remaining: 2 });
});

Deno.test("bundle gate denies a fresh user when payments are enabled", async () => {
  const res = await app(context({ payments_enabled: true })).request("/books/habits/bundle", {
    headers: { "x-app-user-id": "u_fresh" },
  });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), {
    ok: false,
    error: { code: "LOCKED", message: "book is locked" },
  });
});

Deno.test("bundle gate redirects an entitled user with an ETag and no body", async () => {
  const res = await app(context({ payments_enabled: true })).request("/books/habits/bundle", {
    headers: { "x-app-user-id": "u_ent" },
  });
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("etag"), '"v1"');
  assertEquals(res.headers.get("location")?.endsWith("bundle-habits-en-v1.json"), true);
  assertEquals(await res.text(), "");
});

Deno.test("matching If-None-Match returns an empty 304", async () => {
  const res = await app(context({ payments_enabled: true })).request("/books/habits/bundle", {
    headers: { "x-app-user-id": "u_ent", "if-none-match": '"v1"' },
  });
  assertEquals(res.status, 304);
  assertEquals(res.headers.get("etag"), '"v1"');
  assertEquals(await res.text(), "");
});

Deno.test("bundle gate caches the per-user access decision for 60 seconds", async () => {
  const db = seededDb({ payments_enabled: true });
  const ctx = context({}, {}, db);
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_ent" } });
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_ent" } });
  assertEquals(db.checkAccessCalls, 1);
});
