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

Deno.test("phase 0 catalog skips the per-user access lookup entirely", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.books[0].unlocked_for_me, true);
  assertEquals(body.books[0].price_tier, "paid");
  assertEquals(db.checkAccessCalls, 0);
});

Deno.test("paid-mode catalog still resolves per-user access", async () => {
  const db = seededDb({ payments_enabled: true });
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.books[0].unlocked_for_me, false);
  assertEquals(body.books[0].price_tier, "free_eligible");
  assertEquals(db.checkAccessCalls, 1);
});

Deno.test("flags query runs once per cache window across routes", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const catalog = await app(ctx).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  const bundle = await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(catalog.status, 200);
  assertEquals(bundle.status, 302);
  assertEquals(db.getFlagsCalls, 1);
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

Deno.test("webhook rejects bad or missing secret with 401 and zero writes", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer wrong_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_id: "evt_bad",
      app_user_id: "u_fresh",
      book_id: "habits",
      type: "purchase",
    }),
  });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "INVALID");
  const access = await db.checkAccess("u_fresh", ["habits"]);
  assertEquals(access.entitledBookIds, []);
});

Deno.test("webhook purchase grants entitlement and returns 200", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_id: "evt_purchase_1",
      app_user_id: "u_fresh",
      book_id: "habits",
      type: "purchase",
    }),
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  const access = await db.checkAccess("u_fresh", ["habits"]);
  assertEquals(access.entitledBookIds, ["habits"]);
});

Deno.test("webhook replays same event_id idempotently without duplicate writes", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const payload = {
    event_id: "evt_idempotent_1",
    app_user_id: "u_fresh",
    book_id: "habits",
    type: "purchase",
  };
  const headers = {
    authorization: "Bearer test_rc_secret",
    "content-type": "application/json",
  };
  const first = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  assertEquals(first.status, 200);
  assertEquals(await first.json(), { ok: true });

  const second = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  assertEquals(second.status, 200);
  assertEquals(await second.json(), { ok: true });
  const access = await db.checkAccess("u_fresh", ["habits"]);
  assertEquals(access.entitledBookIds, ["habits"]);
});

Deno.test("webhook cancellation removes entitlement and returns 200", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const initialAccess = await db.checkAccess("u_ent", ["habits"]);
  assertEquals(initialAccess.entitledBookIds, ["habits"]);

  const res = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_id: "evt_cancel_1",
      app_user_id: "u_ent",
      book_id: "habits",
      type: "cancellation",
    }),
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  const finalAccess = await db.checkAccess("u_ent", ["habits"]);
  assertEquals(finalAccess.entitledBookIds, []);
});

// --- Task 6: account + backup + requests + devices ---

Deno.test("POST /account upserts and returns preserved counts", async () => {
  const db = seededDb({ payments_enabled: true });
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/account", {
    method: "POST",
    headers: { "x-app-user-id": "u_ent", "content-type": "application/json" },
    body: JSON.stringify({ email: "u@test.com" }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assertEquals(typeof body.preserved.claims, "number");
  assertEquals(typeof body.preserved.entitlements, "number");
});

Deno.test("POST /account returns 409 CONFLICT when email belongs to another user", async () => {
  const db = seededDb();
  await db.upsertAccount("u_other", "taken@test.com");
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/account", {
    method: "POST",
    headers: { "x-app-user-id": "u_fresh", "content-type": "application/json" },
    body: JSON.stringify({ email: "taken@test.com" }),
  });
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "CONFLICT");
});

Deno.test("backup roundtrip preserves blob and reports versions", async () => {
  const db = seededDb();
  await db.upsertAccount("u_bak");
  const ctx = context({}, {}, db);
  const blob = { version: 1, books: [{ book_id: "habits", bundle_version: 1, state: { x: 1 }, chapter_pointer: 0, furthest_chapter: 0, path_log_per_chapter: {} }] };
  const postRes = await app(ctx).request("/account/backup", {
    method: "POST",
    headers: { "x-app-user-id": "u_bak", "content-type": "application/json" },
    body: JSON.stringify(blob),
  });
  assertEquals(postRes.status, 200);
  assertEquals((await postRes.json()).ok, true);

  const getRes = await app(ctx).request("/account/backup", {
    headers: { "x-app-user-id": "u_bak" },
  });
  assertEquals(getRes.status, 200);
  const getBody = await getRes.json();
  assertEquals(getBody.ok, true);
  assertEquals(getBody.blob.version, 1);
  assertEquals(getBody.versions.habits, 1);
});

Deno.test("oversize backup blob returns 400 INVALID", async () => {
  const db = seededDb();
  await db.upsertAccount("u_big");
  const ctx = context({}, {}, db);
  const huge = { version: 1, books: [{ book_id: "x", bundle_version: 1, state: { data: "x".repeat(1_100_000) }, chapter_pointer: 0, furthest_chapter: 0, path_log_per_chapter: {} }] };
  const res = await app(ctx).request("/account/backup", {
    method: "POST",
    headers: { "x-app-user-id": "u_big", "content-type": "application/json" },
    body: JSON.stringify(huge),
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID");
});

Deno.test("GET /account/backup returns 404 when none exists", async () => {
  const ctx = context();
  const res = await app(ctx).request("/account/backup", {
    headers: { "x-app-user-id": "u_nobody" },
  });
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "NOT_FOUND");
});

Deno.test("GET /account/backup returns 412 when blob version exceeds max_version", async () => {
  const db = seededDb();
  await db.upsertBackup("u_v2", { version: 2, books: [] }, 2);
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/account/backup?max_version=1", {
    headers: { "x-app-user-id": "u_v2" },
  });
  assertEquals(res.status, 412);
  assertEquals((await res.json()).error.code, "INVALID");
});

Deno.test("POST /requests by a free user without account returns 403 LOCKED", async () => {
  const ctx = context();
  const res = await app(ctx).request("/requests", {
    method: "POST",
    headers: { "x-app-user-id": "u_fresh", "content-type": "application/json" },
    body: JSON.stringify({ requested_title: "My Book" }),
  });
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, "LOCKED");
});

Deno.test("POST /requests succeeds for a premium user", async () => {
  const db = seededDb();
  await db.upsertEntitlement("u_prem", "*");
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/requests", {
    method: "POST",
    headers: { "x-app-user-id": "u_prem", "content-type": "application/json" },
    body: JSON.stringify({ requested_title: "Cool Book" }),
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).ok, true);
});

Deno.test("second request in 7 days returns 429 RATE_LIMITED", async () => {
  const db = seededDb();
  await db.upsertEntitlement("u_rate", "*");
  await db.createRequest("u_rate", "First");
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/requests", {
    method: "POST",
    headers: { "x-app-user-id": "u_rate", "content-type": "application/json" },
    body: JSON.stringify({ requested_title: "Second" }),
  });
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.code, "RATE_LIMITED");
});

Deno.test("device register and unregister return 200", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const regRes = await app(ctx).request("/devices/register", {
    method: "POST",
    headers: { "x-app-user-id": "u_dev", "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios", token: "tok_abc" }),
  });
  assertEquals(regRes.status, 200);
  assertEquals((await regRes.json()).ok, true);
  assertEquals(db.hasDevice("tok_abc"), true);

  const delRes = await app(ctx).request("/devices/tok_abc", {
    method: "DELETE",
    headers: { "x-app-user-id": "u_dev" },
  });
  assertEquals(delRes.status, 200);
  assertEquals((await delRes.json()).ok, true);
  assertEquals(db.hasDevice("tok_abc"), false);
});
