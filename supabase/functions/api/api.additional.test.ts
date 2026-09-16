import { assertEquals } from "jsr:@std/assert";
import { app } from "./index.ts";
import { MemoryCache, type Cache } from "./lib/cache.ts";
import { FakeDb, SupabaseDb, type BookRecord, type BookStatus, type FakeDbOptions } from "./lib/db.ts";
import { context, seededDb } from "./test-fixtures.ts";

function makeBook(id: string, version = 1, status: BookStatus = "published", bundleUrl = `bundles/${id}-v${version}.json`): BookRecord {
  return { id, title: `Title ${id}`, description: `Description ${id}`, status, bundle_version: version, bundle_url: bundleUrl };
}

function customContext(flags: Record<string, unknown>, options: FakeDbOptions) {
  return context(flags, {}, new FakeDb(flags, options));
}

async function assertFailure(action: () => Promise<unknown>, expected: string): Promise<void> {
  let message = "";
  try {
    await action();
  } catch (error) {
    message = String(error);
  }
  assertEquals(message.includes(expected), true);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function adapter(responses: Response[], env: Record<string, string> = { SUPABASE_URL: "https://project.test", SUPABASE_SERVICE_ROLE_KEY: "secret" }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch call");
    return response;
  };
  return { db: new SupabaseDb({ env, fetcher }), calls };
}

const identityCases = [
  { name: "query identity", path: "/catalog?app_user_id=u_fresh", headers: {} as Record<string, string>, status: 200 },
  { name: "trimmed header identity", path: "/books/habits/bundle", headers: { "x-app-user-id": " u_ent " }, status: 302 },
  { name: "query identity on bundle", path: "/books/habits/bundle?app_user_id=u_ent", headers: {} as Record<string, string>, status: 302 },
  { name: "empty header falls back to query", path: "/catalog?app_user_id=u_ent", headers: { "x-app-user-id": "   " }, status: 200 },
];
for (const testCase of identityCases) {
  Deno.test(`identity middleware accepts ${testCase.name}`, async () => {
    const res = await app(context({ payments_enabled: true })).request(testCase.path, { headers: testCase.headers });
    assertEquals(res.status, testCase.status);
  });
}

Deno.test("identity middleware rejects a blank header and query", async () => {
  const res = await app(context()).request("/catalog?app_user_id=   ", { headers: { "x-app-user-id": "   " } });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID");
});

Deno.test("identity middleware prefers the header over a different query identity", async () => {
  const res = await app(context({ payments_enabled: true })).request("/catalog?app_user_id=u_fresh", { headers: { "x-app-user-id": "u_ent" } });
  assertEquals((await res.json()).books[0].unlocked_for_me, true);
});

Deno.test("webhook namespace bypasses identity even with no query", async () => {
  const res = await app(context()).request("/webhooks/revenuecat?app_user_id=");
  assertEquals(res.status, 404);
});

Deno.test("non-webhook unknown routes still require identity", async () => {
  const res = await app(context()).request("/unknown");
  assertEquals(res.status, 400);
});

Deno.test("unknown routes with identity use the NOT_FOUND envelope", async () => {
  const res = await app(context()).request("/unknown", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "NOT_FOUND");
});

const flagCases = [
  { name: "uppercase environment value", flags: {}, env: { PAYMENTS_ENABLED: "TRUE" }, expected: false },
  { name: "empty environment value", flags: {}, env: { PAYMENTS_ENABLED: "" }, expected: false },
  { name: "string database value falls back to environment", flags: { payments_enabled: "true" }, env: { PAYMENTS_ENABLED: "true" }, expected: true },
  { name: "null database value falls back to environment", flags: { payments_enabled: null }, env: { PAYMENTS_ENABLED: "true" }, expected: true },
  { name: "false database value overrides environment", flags: { payments_enabled: false }, env: { PAYMENTS_ENABLED: "true" }, expected: false },
  { name: "true database value overrides environment", flags: { payments_enabled: true }, env: { PAYMENTS_ENABLED: "false" }, expected: true },
];
for (const testCase of flagCases) {
  Deno.test(`payments flag handles ${testCase.name}`, async () => {
    const res = await app(context(testCase.flags, testCase.env)).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
    assertEquals(res.status, 200);
    assertEquals((await res.json()).books[0].unlocked_for_me, !testCase.expected);
  });
}

Deno.test("memory cache overwrites a value for the same key", async () => {
  const cache = new MemoryCache();
  await cache.set("key", "first", 60);
  await cache.set("key", "second", 60);
  assertEquals(await cache.get("key"), "second");
});

Deno.test("memory cache isolates keys", async () => {
  const cache = new MemoryCache();
  await cache.set("one", "1", 60);
  await cache.set("two", "2", 60);
  assertEquals(await cache.get("one"), "1");
  assertEquals(await cache.get("two"), "2");
});

Deno.test("memory cache expires a zero-second value", async () => {
  const cache = new MemoryCache();
  await cache.set("zero", "value", 0);
  assertEquals(await cache.get("zero"), null);
});

Deno.test("memory cache rejects negative TTL", async () => {
  await assertFailure(() => new MemoryCache().set("key", "value", -1), "non-negative");
});

Deno.test("memory cache rejects infinite TTL", async () => {
  await assertFailure(() => new MemoryCache().set("key", "value", Number.POSITIVE_INFINITY), "finite");
});

Deno.test("memory cache rejects NaN TTL", async () => {
  await assertFailure(() => new MemoryCache().set("key", "value", Number.NaN), "finite");
});

const knownVersionCases = [
  { value: "habits:0", expected: true },
  { value: "habits:1", expected: false },
  { value: "habits:2", expected: false },
  { value: "unknown:0", expected: false },
];
for (const testCase of knownVersionCases) {
  Deno.test(`catalog known version ${testCase.value} reports update correctly`, async () => {
    const res = await app(context()).request(`/catalog?known=${testCase.value}`, { headers: { "x-app-user-id": "u_fresh" } });
    assertEquals((await res.json()).books[0].has_update, testCase.expected);
  });
}

const invalidKnownCases = ["habits", "habits:x", "habits:-1", "habits:1.5", ":1", "habits:9007199254740992"];
for (const value of invalidKnownCases) {
  Deno.test(`catalog rejects malformed known version ${value}`, async () => {
    const res = await app(context()).request(`/catalog?known=${encodeURIComponent(value)}`, { headers: { "x-app-user-id": "u_fresh" } });
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error.code, "INVALID");
  });
}

Deno.test("catalog uses the last value for a repeated known book version", async () => {
  const res = await app(context()).request("/catalog?known=habits:0,habits:1", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals((await res.json()).books[0].has_update, false);
});

Deno.test("catalog supports multiple published books", async () => {
  const books = [makeBook("alpha", 1), makeBook("beta", 3)];
  const res = await app(customContext({ payments_enabled: true }, { books })).request("/catalog?known=alpha:0,beta:3", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals((await res.json()).books, [
    { id: "alpha", title: "Title alpha", description: "Description alpha", price_tier: "free_eligible", unlocked_for_me: false, bundle_version: 1, has_update: true },
    { id: "beta", title: "Title beta", description: "Description beta", price_tier: "free_eligible", unlocked_for_me: false, bundle_version: 3, has_update: false },
  ]);
});

Deno.test("catalog excludes draft books", async () => {
  const db = new FakeDb({}, { books: [makeBook("live"), makeBook("draft", 1, "draft")] });
  const res = await app(context({}, {}, db)).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals((await res.json()).books.map((book: { id: string }) => book.id), ["live"]);
});

Deno.test("catalog returns an empty list when no book is published", async () => {
  const db = new FakeDb({}, { books: [makeBook("draft", 1, "draft")] });
  const res = await app(context({}, {}, db)).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals((await res.json()).books, []);
});

Deno.test("catalog marks a claimed book unlocked", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], claims: [{ appUserId: "u_claimed", bookId: "book" }] });
  const res = await app(context({}, {}, db)).request("/catalog", { headers: { "x-app-user-id": "u_claimed" } });
  const book = (await res.json()).books[0];
  assertEquals(book.unlocked_for_me, true);
  assertEquals(book.price_tier, "paid");
});

Deno.test("catalog marks an entitled book unlocked", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], entitlements: [{ appUserId: "u_entitled", bookId: "book" }] });
  const res = await app(context({}, {}, db)).request("/catalog", { headers: { "x-app-user-id": "u_entitled" } });
  assertEquals((await res.json()).books[0].unlocked_for_me, true);
});

Deno.test("catalog honors the all-books entitlement marker", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("one"), makeBook("two")], entitlements: [{ appUserId: "u_all", bookId: "*" }] });
  const res = await app(context({}, {}, db)).request("/catalog", { headers: { "x-app-user-id": "u_all" } });
  assertEquals((await res.json()).books.every((book: { unlocked_for_me: boolean }) => book.unlocked_for_me), true);
});

Deno.test("catalog marks a user with three claims paid", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], claims: [
    { appUserId: "u_full", bookId: "a" },
    { appUserId: "u_full", bookId: "b" },
    { appUserId: "u_full", bookId: "c" },
  ] });
  const res = await app(context({}, {}, db)).request("/catalog", { headers: { "x-app-user-id": "u_full" } });
  assertEquals((await res.json()).books[0].price_tier, "paid");
});

Deno.test("catalog recovers from corrupt book-list cache data", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  await ctx.cache.set("books:published", "not-json", 60);
  const res = await app(ctx).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 200);
  assertEquals(db.listBooksCalls, 1);
});

Deno.test("catalog shares book metadata cache but not access results between users", async () => {
  const db = seededDb({ payments_enabled: true });
  const ctx = context({}, {}, db);
  await app(ctx).request("/catalog", { headers: { "x-app-user-id": "u_fresh" } });
  await app(ctx).request("/catalog", { headers: { "x-app-user-id": "u_ent" } });
  assertEquals(db.listBooksCalls, 1);
  assertEquals(db.checkAccessCalls, 2);
});

const claimCountCases = [
  { name: "first", claims: [], remaining: 2 },
  { name: "second", claims: [{ appUserId: "u", bookId: "a" }], remaining: 1 },
  { name: "third", claims: [{ appUserId: "u", bookId: "a" }, { appUserId: "u", bookId: "b" }], remaining: 0 },
];
for (const testCase of claimCountCases) {
  Deno.test(`claim-free returns remaining count after the ${testCase.name} claim`, async () => {
    const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], claims: testCase.claims });
    const res = await app(context({}, {}, db)).request("/books/book/claim-free", { method: "POST", headers: { "x-app-user-id": "u" }, body: "{}" });
    assertEquals(res.status, 200);
    assertEquals((await res.json()).remaining, testCase.remaining);
  });
}

Deno.test("claim-free rejects the fourth distinct claim without inserting it", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], claims: [
    { appUserId: "u", bookId: "a" },
    { appUserId: "u", bookId: "b" },
    { appUserId: "u", bookId: "c" },
  ] });
  const res = await app(context({}, {}, db)).request("/books/book/claim-free", { method: "POST", headers: { "x-app-user-id": "u" }, body: "{}" });
  assertEquals(res.status, 409);
  assertEquals(db.hasClaim("u", "book"), false);
});

Deno.test("claim-free allows re-claiming an owned book at the limit", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], claims: [
    { appUserId: "u", bookId: "a" },
    { appUserId: "u", bookId: "b" },
    { appUserId: "u", bookId: "book" },
  ] });
  const res = await app(context({}, {}, db)).request("/books/book/claim-free", { method: "POST", headers: { "x-app-user-id": "u" }, body: "{}" });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).remaining, 0);
});

Deno.test("claim-free uses query identity when the header is absent", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")] });
  const res = await app(context({}, {}, db)).request("/books/book/claim-free?app_user_id=u", { method: "POST", body: "{}" });
  assertEquals(res.status, 200);
});

Deno.test("claim-free header identity wins over query identity", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], claims: [
    { appUserId: "u_header", bookId: "a" },
    { appUserId: "u_header", bookId: "b" },
    { appUserId: "u_header", bookId: "c" },
  ] });
  const res = await app(context({}, {}, db)).request("/books/book/claim-free?app_user_id=u_query", { method: "POST", headers: { "x-app-user-id": "u_header" }, body: "{}" });
  assertEquals(res.status, 409);
  assertEquals(db.hasClaim("u_query", "book"), false);
});

Deno.test("claim-free returns NOT_FOUND for an unknown book", async () => {
  const res = await app(context({ payments_enabled: true })).request("/books/missing/claim-free", { method: "POST", headers: { "x-app-user-id": "u_fresh" }, body: "{}" });
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "NOT_FOUND");
});

Deno.test("claim-free returns NOT_FOUND for a draft book", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("draft", 1, "draft")] });
  const res = await app(context({}, {}, db)).request("/books/draft/claim-free", { method: "POST", headers: { "x-app-user-id": "u" }, body: "{}" });
  assertEquals(res.status, 404);
});

Deno.test("claim-free route rejects GET requests", async () => {
  const res = await app(context()).request("/books/habits/claim-free", { method: "GET", headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 404);
});

Deno.test("claim-free phase 0 logs a fourth distinct claim", async () => {
  const db = seededDb();
  const res = await app(context({}, {}, db)).request("/books/habits/claim-free", { method: "POST", headers: { "x-app-user-id": "u_free" }, body: "{}" });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).monitor_only, true);
  assertEquals(db.hasClaim("u_free", "habits"), true);
});

Deno.test("claim-free phase 0 reports monitor mode on a re-claim", async () => {
  const db = seededDb();
  await app(context({}, {}, db)).request("/books/habits/claim-free", { method: "POST", headers: { "x-app-user-id": "u_free" }, body: "{}" });
  const res = await app(context({}, {}, db)).request("/books/habits/claim-free", { method: "POST", headers: { "x-app-user-id": "u_free" }, body: "{}" });
  const body = await res.json();
  assertEquals(body.monitor_only, true);
  assertEquals(body.remaining, 3);
});

const bundleCases = [
  { name: "fresh user denied", user: "u_fresh", status: 403 },
  { name: "entitled user allowed", user: "u_ent", status: 302 },
];
for (const testCase of bundleCases) {
  Deno.test(`bundle gate handles ${testCase.name}`, async () => {
    const res = await app(context({ payments_enabled: true })).request("/books/habits/bundle", { headers: { "x-app-user-id": testCase.user } });
    assertEquals(res.status, testCase.status);
  });
}

Deno.test("bundle gate skips access lookup in phase 0", async () => {
  const db = seededDb();
  const res = await app(context({}, {}, db)).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 302);
  assertEquals(db.checkAccessCalls, 0);
});

Deno.test("bundle gate accepts query identity", async () => {
  const res = await app(context({ payments_enabled: true })).request("/books/habits/bundle?app_user_id=u_ent");
  assertEquals(res.status, 302);
});

Deno.test("bundle gate returns NOT_FOUND for an unknown book", async () => {
  const res = await app(context()).request("/books/missing/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 404);
});

Deno.test("bundle gate returns NOT_FOUND for a draft book", async () => {
  const db = new FakeDb({}, { books: [makeBook("draft", 1, "draft")] });
  const res = await app(context({}, {}, db)).request("/books/draft/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 404);
});

Deno.test("bundle gate returns NOT_FOUND when a published book has no URL", async () => {
  const db = new FakeDb({}, { books: [makeBook("empty", 1, "published", "")] });
  const res = await app(context({}, {}, db)).request("/books/empty/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(res.status, 404);
});

Deno.test("bundle gate permits a claimed user", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], claims: [{ appUserId: "u", bookId: "book" }] });
  const res = await app(context({}, {}, db)).request("/books/book/bundle", { headers: { "x-app-user-id": "u" } });
  assertEquals(res.status, 302);
});

Deno.test("bundle gate permits an all-books entitlement", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book")], entitlements: [{ appUserId: "u", bookId: "*" }] });
  const res = await app(context({}, {}, db)).request("/books/book/bundle", { headers: { "x-app-user-id": "u" } });
  assertEquals(res.status, 302);
});

Deno.test("bundle gate caches a denied access result", async () => {
  const db = seededDb({ payments_enabled: true });
  const ctx = context({}, {}, db);
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(db.checkAccessCalls, 1);
});

Deno.test("bundle gate caches an allowed access result", async () => {
  const db = seededDb({ payments_enabled: true });
  const ctx = context({}, {}, db);
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_ent" } });
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_ent" } });
  assertEquals(db.checkAccessCalls, 1);
});

Deno.test("bundle gate keeps access cache entries separate by user", async () => {
  const db = seededDb({ payments_enabled: true });
  const ctx = context({}, {}, db);
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_ent" } });
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(db.checkAccessCalls, 2);
});

Deno.test("bundle gate keeps access cache entries separate by book", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("one"), makeBook("two")], entitlements: [{ appUserId: "u", bookId: "one" }] });
  const ctx = context({}, {}, db);
  await app(ctx).request("/books/one/bundle", { headers: { "x-app-user-id": "u" } });
  await app(ctx).request("/books/two/bundle", { headers: { "x-app-user-id": "u" } });
  assertEquals(db.checkAccessCalls, 2);
});

const etagCases = [
  { name: "missing", header: undefined, status: 302 },
  { name: "exact", header: '"v1"', status: 304 },
  { name: "weak", header: 'W/"v1"', status: 304 },
  { name: "comma separated", header: '"old", "v1"', status: 304 },
  { name: "wildcard", header: "*", status: 304 },
  { name: "stale", header: '"v0"', status: 302 },
];
for (const testCase of etagCases) {
  Deno.test(`bundle ETag handles ${testCase.name} validator`, async () => {
    const headers: Record<string, string> = { "x-app-user-id": "u_ent" };
    if (testCase.header !== undefined) headers["if-none-match"] = testCase.header;
    const res = await app(context({ payments_enabled: true })).request("/books/habits/bundle", { headers });
    assertEquals(res.status, testCase.status);
    assertEquals(res.headers.get("etag"), '"v1"');
  });
}

Deno.test("bundle redirect has no body", async () => {
  const res = await app(context({ payments_enabled: true })).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_ent" } });
  assertEquals(await res.text(), "");
});

Deno.test("bundle 304 has no body", async () => {
  const res = await app(context({ payments_enabled: true })).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_ent", "if-none-match": '"v1"' } });
  assertEquals(await res.text(), "");
});

Deno.test("bundle gate returns the current version ETag", async () => {
  const db = new FakeDb({ payments_enabled: true }, { books: [makeBook("book", 7)], entitlements: [{ appUserId: "u", bookId: "book" }] });
  const res = await app(context({}, {}, db)).request("/books/book/bundle", { headers: { "x-app-user-id": "u" } });
  assertEquals(res.headers.get("etag"), '"v7"');
});

const adapterEnv = { SUPABASE_URL: "https://project.test", SUPABASE_SERVICE_ROLE_KEY: "secret" };

Deno.test("SupabaseDb rejects missing service configuration", async () => {
  const { db } = adapter([], {});
  await assertFailure(() => db.getFlags(), "missing SUPABASE_URL");
});

Deno.test("SupabaseDb reads flags and sends service headers", async () => {
  const { db, calls } = adapter([jsonResponse([{ key: "payments_enabled", value: true }])]);
  assertEquals(await db.getFlags(), { payments_enabled: true });
  assertEquals(calls[0].url.includes("/rest/v1/flags"), true);
  assertEquals((calls[0].init?.headers as Record<string, string>).apikey, "secret");
  assertEquals((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer secret");
});

Deno.test("SupabaseDb surfaces flag HTTP failures", async () => {
  const { db } = adapter([new Response("failure", { status: 503 })]);
  await assertFailure(() => db.getFlags(), "status 503");
});

Deno.test("SupabaseDb rejects a non-array flag response", async () => {
  const { db } = adapter([jsonResponse({ key: "payments_enabled" })]);
  await assertFailure(() => db.getFlags(), "invalid response");
});

Deno.test("SupabaseDb skips an invalid flag row and keeps valid ones", async () => {
  const { db } = adapter([jsonResponse([{ key: "payments_enabled", value: true }, {}])]);
  // Lenient by design: a malformed flags row must not take the gate down.
  assertEquals(await db.getFlags(), { payments_enabled: true });
});

Deno.test("SupabaseDb lists only published books", async () => {
  const { db, calls } = adapter([jsonResponse([makeBook("one")])]);
  assertEquals((await db.listBooks()).length, 1);
  assertEquals(calls[0].url.includes("status=eq.published"), true);
});

Deno.test("SupabaseDb rejects an invalid book row", async () => {
  const { db } = adapter([jsonResponse([{ id: "book" }])]);
  await assertFailure(() => db.listBooks(), "invalid row");
});

Deno.test("SupabaseDb returns null for a missing book", async () => {
  const { db } = adapter([jsonResponse([])]);
  assertEquals(await db.getBook("missing"), null);
});

Deno.test("SupabaseDb returns a draft book for the route to reject", async () => {
  const { db } = adapter([jsonResponse([makeBook("draft", 1, "draft")])]);
  assertEquals((await db.getBook("draft"))?.status, "draft");
});

Deno.test("SupabaseDb rejects an invalid book response", async () => {
  const { db } = adapter([jsonResponse({ id: "book" })]);
  await assertFailure(() => db.getBook("book"), "invalid response");
});

Deno.test("SupabaseDb combines claims and entitlements", async () => {
  const { db } = adapter([jsonResponse([{ book_id: "claimed" }]), jsonResponse([{ book_id: "entitled" }])]);
  assertEquals(await db.checkAccess("u", ["claimed", "entitled", "other"]), {
    claimedBookIds: ["claimed"],
    entitledBookIds: ["entitled"],
    freeClaimCount: 1,
  });
});

Deno.test("SupabaseDb honors all-books entitlement", async () => {
  const { db } = adapter([jsonResponse([]), jsonResponse([{ book_id: "*" }])]);
  assertEquals((await db.checkAccess("u", ["one", "two"])).entitledBookIds, ["one", "two"]);
});

Deno.test("SupabaseDb rejects malformed claims", async () => {
  const { db } = adapter([jsonResponse([{}]), jsonResponse([])]);
  await assertFailure(() => db.checkAccess("u", ["book"]), "invalid row");
});

Deno.test("SupabaseDb rejects malformed entitlements", async () => {
  const { db } = adapter([jsonResponse([]), jsonResponse([{}])]);
  await assertFailure(() => db.checkAccess("u", ["book"]), "invalid row");
});

Deno.test("SupabaseDb parses a successful claim RPC", async () => {
  const { db, calls } = adapter([jsonResponse({ status: "claimed", already_claimed: false, remaining: 2 })]);
  assertEquals(await db.claimFree("u", "book"), { status: "claimed", alreadyClaimed: false, remaining: 2 });
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(JSON.parse(String(calls[0].init?.body)).p_enforce_limit, true);
});

Deno.test("SupabaseDb parses a claim limit RPC", async () => {
  const { db } = adapter([jsonResponse({ status: "limit_reached", remaining: 0 })]);
  assertEquals(await db.claimFree("u", "book"), { status: "limit_reached", remaining: 0 });
});

Deno.test("SupabaseDb parses a missing-book claim RPC", async () => {
  const { db } = adapter([jsonResponse({ status: "not_found" })]);
  assertEquals(await db.claimFree("u", "missing"), { status: "not_found" });
});

Deno.test("SupabaseDb rejects an invalid claim RPC result", async () => {
  const { db } = adapter([jsonResponse({ status: "unexpected" })]);
  await assertFailure(() => db.claimFree("u", "book"), "invalid result");
});

Deno.test("SupabaseDb surfaces claim RPC HTTP failures", async () => {
  const { db } = adapter([new Response("failure", { status: 409 })]);
  await assertFailure(() => db.claimFree("u", "book"), "status 409");
});

Deno.test("webhook handles all_books entitlement expanding to wildcard *", async () => {
  const db = seededDb({ payments_enabled: true });
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_id: "evt_all_books_1",
      app_user_id: "u_fresh",
      entitlement: "all_books",
      type: "purchase",
    }),
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(db.hasEntitlement("u_fresh", "*"), true);
  const access = await db.checkAccess("u_fresh", ["habits"]);
  assertEquals(access.entitledBookIds, ["habits"]);
});

Deno.test("webhook handles nested RevenueCat payload format", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event: {
        id: "evt_nested_1",
        app_user_id: "u_nested",
        entitlement_ids: ["all_books"],
        type: "INITIAL_PURCHASE",
      },
    }),
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(db.hasEntitlement("u_nested", "*"), true);
});

Deno.test("webhook handles expiration/refund removing entitlement", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  await db.upsertEntitlement("u_exp", "*");
  assertEquals(db.hasEntitlement("u_exp", "*"), true);

  const res = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_id: "evt_exp_1",
      app_user_id: "u_exp",
      book_id: "*",
      type: "EXPIRATION",
    }),
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(db.hasEntitlement("u_exp", "*"), false);
});

Deno.test("webhook informational event does not modify entitlements", async () => {
  const db = seededDb();
  const ctx = context({}, {}, db);
  const res = await app(ctx).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      event_id: "evt_test_info",
      app_user_id: "u_fresh",
      type: "TEST",
    }),
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(db.hasRevenueEvent("evt_test_info"), true);
  assertEquals(db.hasEntitlement("u_fresh", "habits"), false);
});

Deno.test("webhook rejects malformed JSON with 400 INVALID", async () => {
  const res = await app(context()).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: "{not-valid-json",
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "INVALID");
});

Deno.test("webhook rejects missing required event fields with 400 INVALID", async () => {
  const res = await app(context()).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ event_id: "e1" }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "INVALID");
});

Deno.test("webhook rejects grant event missing book_id and entitlement with 400 INVALID", async () => {
  const res = await app(context()).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ event_id: "e1", app_user_id: "u1", type: "purchase" }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "INVALID");
});

Deno.test("webhook rejects authorization header without Bearer prefix with 401", async () => {
  const res = await app(context()).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "test_rc_secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ event_id: "e1", app_user_id: "u1", book_id: "habits", type: "purchase" }),
  });
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "INVALID");
});

Deno.test("webhook timingSafeEqual safely handles different length secrets", async () => {
  const shortRes = await app(context()).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer x",
      "content-type": "application/json",
    },
    body: JSON.stringify({ event_id: "e1", app_user_id: "u1", book_id: "habits", type: "purchase" }),
  });
  assertEquals(shortRes.status, 401);

  const longRes = await app(context()).request("/webhooks/revenuecat", {
    method: "POST",
    headers: {
      authorization: "Bearer very_long_secret_that_exceeds_length_of_configured_secret_by_far",
      "content-type": "application/json",
    },
    body: JSON.stringify({ event_id: "e1", app_user_id: "u1", book_id: "habits", type: "purchase" }),
  });
  assertEquals(longRes.status, 401);
});

Deno.test("SupabaseDb records revenue event and sets ignore-duplicates", async () => {
  const { db, calls } = adapter([jsonResponse([{ event_id: "evt_1" }])]);
  const result = await db.recordRevenueEvent({
    eventId: "evt_1",
    appUserId: "u1",
    bookId: "*",
    type: "purchase",
  });
  assertEquals(result, { inserted: true });
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(
    (calls[0].init?.headers as Record<string, string>)?.Prefer,
    "resolution=ignore-duplicates,return=representation",
  );
  const parsedBody = JSON.parse(String(calls[0].init?.body));
  assertEquals(parsedBody.event_id, "evt_1");
  assertEquals(parsedBody.book_id, "*");
});

Deno.test("SupabaseDb detects duplicate revenue event", async () => {
  const { db } = adapter([jsonResponse([])]);
  const result = await db.recordRevenueEvent({
    eventId: "evt_dup",
    appUserId: "u1",
    bookId: "*",
    type: "purchase",
  });
  assertEquals(result, { inserted: false });
});

Deno.test("SupabaseDb upserts entitlement with merge-duplicates", async () => {
  const { db, calls } = adapter([new Response(null, { status: 204 })]);
  await db.upsertEntitlement("u1", "habits");
  assertEquals(calls[0].init?.method, "POST");
  assertEquals(
    (calls[0].init?.headers as Record<string, string>)?.Prefer,
    "resolution=merge-duplicates,return=minimal",
  );
  const parsedBody = JSON.parse(String(calls[0].init?.body));
  assertEquals(parsedBody.app_user_id, "u1");
  assertEquals(parsedBody.book_id, "habits");
});

Deno.test("SupabaseDb deletes entitlement", async () => {
  const { db, calls } = adapter([new Response(null, { status: 204 })]);
  await db.deleteEntitlement("u1", "*");
  assertEquals(calls[0].init?.method, "DELETE");
  assertEquals(calls[0].url.includes("book_id=eq.%2A"), true);
});


// --- P1-1: atomic apply_revenue_event (marker + entitlement in one call) ---

Deno.test("SupabaseDb applies revenue events through the atomic RPC", async () => {
  const { db, calls } = adapter([jsonResponse({ inserted: true })]);
  const result = await db.applyRevenueEvent(
    { eventId: "evt_atomic_1", appUserId: "u1", bookId: "*", type: "INITIAL_PURCHASE" },
    "grant",
  );
  assertEquals(result, { inserted: true });
  assertEquals(calls[0].url.includes("/rest/v1/rpc/apply_revenue_event"), true);
  const parsedBody = JSON.parse(String(calls[0].init?.body));
  assertEquals(parsedBody.p_event_id, "evt_atomic_1");
  assertEquals(parsedBody.p_app_user_id, "u1");
  assertEquals(parsedBody.p_book_id, "*");
  assertEquals(parsedBody.p_type, "INITIAL_PURCHASE");
  assertEquals(parsedBody.p_action, "grant");
});

Deno.test("SupabaseDb reports replayed revenue events as not inserted", async () => {
  const { db } = adapter([jsonResponse({ inserted: false })]);
  const result = await db.applyRevenueEvent(
    { eventId: "evt_replay", appUserId: "u1", bookId: "habits", type: "INITIAL_PURCHASE" },
    "grant",
  );
  assertEquals(result, { inserted: false });
});

Deno.test("SupabaseDb rejects an invalid apply_revenue_event response", async () => {
  const { db } = adapter([jsonResponse({ unexpected: true })]);
  await assertFailure(
    () => db.applyRevenueEvent({ eventId: "e", appUserId: "u", bookId: "", type: "TEST" }, "none"),
    "invalid",
  );
});

Deno.test("FakeDb.applyRevenueEvent records and applies in one step", async () => {
  const db = new FakeDb();
  assertEquals(
    await db.applyRevenueEvent({ eventId: "e1", appUserId: "u", bookId: "habits", type: "INITIAL_PURCHASE" }, "grant"),
    { inserted: true },
  );
  assertEquals(db.hasEntitlement("u", "habits"), true);

  // Replay returns inserted=false and must not resurrect a revoked entitlement.
  assertEquals(
    await db.applyRevenueEvent({ eventId: "e1", appUserId: "u", bookId: "habits", type: "INITIAL_PURCHASE" }, "grant"),
    { inserted: false },
  );
  assertEquals(
    await db.applyRevenueEvent({ eventId: "e2", appUserId: "u", bookId: "habits", type: "EXPIRATION" }, "revoke"),
    { inserted: true },
  );
  assertEquals(db.hasEntitlement("u", "habits"), false);
  assertEquals(db.hasRevenueEvent("e2"), true);

  // Informational events are recorded without touching entitlements.
  assertEquals(
    await db.applyRevenueEvent({ eventId: "e3", appUserId: "u2", bookId: "", type: "TEST" }, "none"),
    { inserted: true },
  );
  assertEquals(db.hasRevenueEvent("e3"), true);
  assertEquals(db.hasEntitlement("u2", "habits"), false);
});

// --- P1-2: asymmetric access-cache TTL (denials 5s, allows 60s) ---

class RecordingCache implements Cache {
  readonly sets: Array<{ key: string; value: string; ttlSec: number }> = [];
  private readonly backing = new Map<string, { value: string; expiresAtMs: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.backing.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= Date.now()) {
      this.backing.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    this.sets.push({ key, value, ttlSec });
    this.backing.set(key, { value, expiresAtMs: Date.now() + ttlSec * 1000 });
  }
}

Deno.test("bundle gate caches denials for 5s and allows for 60s", async () => {
  const db = seededDb({ payments_enabled: true });
  const cache = new RecordingCache();
  const ctx = context({}, {}, db, cache);
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_ent" } });
  const deny = cache.sets.find((s) => s.value === "0");
  const allow = cache.sets.find((s) => s.value === "1");
  assertEquals(deny?.key, "ent:u_fresh:habits");
  assertEquals(deny?.ttlSec, 5);
  assertEquals(allow?.key, "ent:u_ent:habits");
  assertEquals(allow?.ttlSec, 60);
});

Deno.test("bundle gate serves a cached denial without a second access check", async () => {
  const db = seededDb({ payments_enabled: true });
  const cache = new RecordingCache();
  const ctx = context({}, {}, db, cache);
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  await app(ctx).request("/books/habits/bundle", { headers: { "x-app-user-id": "u_fresh" } });
  assertEquals(db.checkAccessCalls, 1);
});
