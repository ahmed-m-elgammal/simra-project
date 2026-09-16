# Plan 03 — API + Push (Supabase Edge, gate + CDN, webhooks)

> For agentic workers: implement task-by-task in order. Steps use checkbox (`- [ ]`) syntax. Do not skip tests; do not commit red. Depends on Plan 01 schemas (reuse `@app/bundle-builder` Zod objects for blob validation).

**Goal:** Server that gates content, mirrors entitlements, stores backups, registers devices, and fires push on extension — with content itself served from CDN, never a live graph query.

**Architecture:** One Supabase project. Single Edge Function `api` with an internal `hono` router (locked dep `hono` — one deploy, shared middleware, route-tested). Postgres holds content snapshot tables (written by `bookforge publish`, Plan 02) + ops tables. Storage/CDN holds bundles. Push sender is an interface (fake in tests, Expo Push HTTP in prod).

**Tech Stack:** TypeScript strict (Deno), `hono`, `supabase-js` (service role inside functions only), `zod`, Deno built-in `crypto.subtle` (webhook verify + ETag). Tests: `deno test` with fake Db/Storage/Push adapters; local stack via Supabase CLI (`supabase start`) for the E2E script.

**Layout this plan creates:**

```
supabase/migrations/001_core.sql          # all tables + indexes + RLS (anon denied, service_role bypasses)
supabase/seed/minibook.sql                # fixture: habits book v1 published + personas/chapters/decisions/options rows
supabase/seed/dev-users.sql               # fixture users: free-claimed, entitled, fresh
supabase/functions/api/index.ts           # hono router + middleware (app_user_id, errors, flags)
supabase/functions/api/routes/catalog.ts
supabase/functions/api/routes/claim.ts
supabase/functions/api/routes/bundle.ts
supabase/functions/api/routes/webhook.ts
supabase/functions/api/routes/account.ts  # account + backup up/down
supabase/functions/api/routes/requests.ts
supabase/functions/api/routes/devices.ts
supabase/functions/api/lib/db.ts          # Db interface + Supabase impl + FakeDb
supabase/functions/api/lib/cache.ts       # Cache interface + memory impl (Redis later, same interface)
supabase/functions/api/lib/push.ts        # PushSender interface + Expo HTTP impl + fake
supabase/functions/api/lib/flags.ts       # payments_enabled + kill switches (env first, flags table override)
supabase/functions/api/api.test.ts        # route tests on fakes (no network)
supabase/functions/api/e2e.local.sh       # seed → catalog → claim → bundle → webhook → backup, local stack only
```

Error envelope (locked, all routes): `{ ok:false, error:{ code, message } }` with codes `LIMIT_REACHED, LOCKED, NOT_FOUND, INVALID, RATE_LIMITED, CONFLICT, ABORTED`. Success: `{ ok:true, ...data }` except bundle (302) and webhook (`{ok:true}`).

---

### Task 1: Migration 001 + RLS + seed + rollback verify

**Files:**
- Create: `supabase/migrations/001_core.sql`, `supabase/seed/minibook.sql`, `supabase/seed/dev-users.sql`

- [ ] **Step 1: Write the migration (exact SQL)**

```sql
create table books (
  id text primary key,
  title text not null,
  author text not null default '',
  status text not null default 'draft' check (status in ('draft','published')),
  bundle_version int not null default 0,
  bundle_url text not null default '',
  bundle_sha text not null default '',
  updated_at timestamptz not null default now()
);
create table book_configs (
  book_id text primary key references books(id) on delete cascade,
  state_variables jsonb not null default '[]',
  bands jsonb not null default '[]',
  bands_compiled jsonb not null default '[]'
);
create table personas (
  id text primary key,
  book_id text not null references books(id) on delete cascade,
  status text not null default 'draft',
  starting_state jsonb not null default '{}',
  gating_base jsonb not null default '{}'
);
create table chapters (
  id text primary key,
  book_id text not null references books(id) on delete cascade,
  status text not null default 'draft',
  "order" int not null,
  title text not null default '',
  content_ref text not null default ''
);
create table decisions (
  id text primary key,
  chapter_id text not null references chapters(id) on delete cascade,
  book_id text not null,
  "order" int not null,
  prompt text not null default ''
);
create table options (
  id text primary key,
  decision_id text not null references decisions(id) on delete cascade,
  chapter_id text not null,
  book_id text not null,
  label text not null default '',
  intent text not null default '',
  next text not null default 'chapter_end',
  requires jsonb,
  lock_reason text not null default '',
  persona_effects jsonb not null default '[]'
);
create table entitlements (
  app_user_id text not null,
  book_id text not null,
  source text not null default 'revenuecat',
  created_at timestamptz not null default now(),
  primary key (app_user_id, book_id)
);
create table free_claims (
  app_user_id text not null,
  book_id text not null,
  created_at timestamptz not null default now(),
  primary key (app_user_id, book_id)
);
create table devices (
  token text primary key,
  app_user_id text not null,
  platform text not null check (platform in ('ios','android')),
  locale text not null default 'en',
  updated_at timestamptz not null default now()
);
create index devices_user_idx on devices (app_user_id);
create table progress (
  app_user_id text not null,
  book_id text not null,
  furthest_chapter int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (app_user_id, book_id)
);
create index progress_book_idx on progress (book_id, furthest_chapter);
create table requests (
  id bigserial primary key,
  app_user_id text not null,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now()
);
create index requests_user_idx on requests (app_user_id, created_at);
create table revenue_events (
  event_id text primary key,
  app_user_id text not null,
  book_id text not null default '',
  type text not null,
  created_at timestamptz not null default now()
);
create table backups (
  app_user_id text primary key,
  blob jsonb not null,
  blob_version int not null,
  updated_at timestamptz not null default now()
);
create table accounts (
  app_user_id text primary key,
  email text,
  created_at timestamptz not null default now()
);
create table flags (
  key text primary key,
  value jsonb not null
);
insert into flags (key, value) values ('payments_enabled', 'false');

alter table books enable row level security;
alter table book_configs enable row level security;
alter table personas enable row level security;
alter table chapters enable row level security;
alter table decisions enable row level security;
alter table options enable row level security;
alter table entitlements enable row level security;
alter table free_claims enable row level security;
alter table devices enable row level security;
alter table progress enable row level security;
alter table requests enable row level security;
alter table revenue_events enable row level security;
alter table backups enable row level security;
alter table accounts enable row level security;
-- No permissive policies: anon gets nothing. Edge Functions use the service_role key and bypass RLS. If a client key ever needs direct reads, add policies then, never now.
```

`personas.starting_state` keys must match that book's config vars (enforced at publish by the builder, not by CHECK — JSONB key rules stay in code where the ledger lives).

- [ ] **Step 2: Write seeds.** `minibook.sql`: the checked-in multi-chapter fixture has book `habits` published v1 + config vars (consistency/energy) + 2 personas + 2 chapters + 2 decisions + 4 options, mirroring the CLI's multi-chapter path. Its size is only test data; production books are iterated from their published chapter rows with no fixed chapter count. `dev-users.sql`: user `u_free` with 3 free_claims (books a,b,c), user `u_ent` with entitlement on `habits`, user `u_fresh` with no access rows, plus `u_caught` and `u_mid` progress fixtures for push-cohort tests.

- [ ] **Step 3: Apply + verify + rollback on local stack**

Run: `supabase start && supabase db reset && psql $LOCAL_DB -c "select count(*) from books;"`
Expected: count matches seed. Then verify RLS: anon-keyed select on books returns 0 rows (policies deny).
Run: `supabase migration list` to confirm 001 applied. Rollback check: `supabase db reset` returns to clean (migrations are the only schema path — never hand-edit the DB).

Machine note (locked): this Docker path runs in CI / on machines with Docker. Machines without Docker run `pnpm verify:sql` instead (`scripts/verify-sql.mjs` on pg-mem: proves SQL parses, seeds apply, PKs/checks/FKs hold, and every table carries its RLS line with zero permissive policies). The one thing pg-mem cannot prove — live anon-deny — stays in `e2e.local.sh` on a real stack and blocks any production deploy without it.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/001_core.sql supabase/seed/minibook.sql supabase/seed/dev-users.sql
git commit -m "feat(api): core schema + RLS deny-by-default + seeds"
```

---

### Task 2: Router scaffold + middleware + flags + cache

**Files:**
- Create: `supabase/functions/api/index.ts`, `supabase/functions/api/lib/db.ts`, `supabase/functions/api/lib/cache.ts`, `supabase/functions/api/lib/flags.ts`
- Test: `supabase/functions/api/api.test.ts` (grows each task; starts with 404 + error envelope + flag tests)

- [x] **Step 1: Write the failing test**

```ts
import { assertEquals } from "jsr:@std/assert";
import { app } from "./index.ts";
import { FakeDb } from "./lib/db.ts";
import { MemoryCache } from "./lib/cache.ts";

const ctx = { db: new FakeDb(), cache: new MemoryCache(), env: { PAYMENTS_ENABLED: "false" } };

Deno.test("unknown route → NOT_FOUND envelope", async () => {
  const res = await app(ctx).request("/nope", { headers: { "x-app-user-id": "u_test" } });
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.error.code, "NOT_FOUND");
});

Deno.test("missing app_user_id → INVALID", async () => {
  const res = await app(ctx).request("/catalog");
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID");
});
```

Router factory takes injected context (real adapters in prod, fakes in tests — no network in unit tests, ever).

- [x] **Step 2: Run test to verify it fails**

Run: `deno test --allow-net supabase/functions/api/api.test.ts`
Expected: FAIL, module missing.

- [x] **Step 3: Write minimal implementation**

```ts
// index.ts
import { Hono } from "hono";

export interface Ctx {
  db: import("./lib/db.ts").Db;
  cache: import("./lib/cache.ts").Cache;
  env: Record<string, string>;
}

export function app(ctx: Ctx) {
  const api = new Hono();
  api.use("*", async (c, next) => {
    const uid = c.req.header("x-app-user-id") ?? c.req.query("app_user_id");
    if (!uid && !c.req.path.startsWith("/webhooks/")) {
      return c.json({ ok: false, error: { code: "INVALID", message: "missing app_user_id" } }, 400);
    }
    c.set("uid", uid ?? "");
    c.set("ctx", ctx);
    await next();
  });
  api.notFound((c) => c.json({ ok: false, error: { code: "NOT_FOUND", message: "no such route" } }, 404));
  api.onError((e, c) => c.json({ ok: false, error: { code: "ABORTED", message: String(e?.message ?? e) } }, 500));
  return api;
}

export default { fetch: (req: Request) => app(prodCtx()).fetch(req) };
```

`flags.ts`: `paymentsEnabled(ctx)` = flags table value if present else `env.PAYMENTS_ENABLED === "true"`; env default false (Phase 0). `cache.ts`: `Cache { get(k): Promise<string|null>; set(k,v,ttlSec): Promise<void> }` + `MemoryCache` (Map with expiry). `db.ts`: `Db` interface grows per task (start with `getFlags(): Promise<Record<string,unknown>>`); `FakeDb` in-memory; Supabase impl reads `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from env only.

- [x] **Step 4: Run test to verify it passes**

Run: `deno test --allow-net supabase/functions/api/api.test.ts`
Expected: PASS, 7 tests.

The checked-in `deno.lock` pins the resolved JSR dependencies. The Node workspace typecheck excludes the Deno Edge tree; Deno is the authoritative typecheck/runtime check for these files.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/api/index.ts supabase/functions/api/lib/ supabase/functions/api/api.test.ts
git commit -m "feat(api): hono router + envelope + flags + cache seam"
```

---

### Task 3: catalog + claim-free

**Files:**
- Create: `supabase/migrations/002_api_catalog_claims.sql` (catalog description + atomic claim transaction)
- Create: `supabase/functions/api/routes/catalog.ts`, `supabase/functions/api/routes/claim.ts`
- Test: extend `api.test.ts`

`GET /catalog`: one fake-able call `db.listBooks()` (published only) + `db.checkAccess(uid, bookIds)` (entitled-or-claimed sets) → per book `{ id, title, description, price_tier, unlocked_for_me, bundle_version, has_update }` (`price_tier`: `free_eligible` for first 3 unclaimed when flag on; `unlocked_for_me=true` for all when `payments_enabled=false`). `has_update` needs device-known versions — client sends `?known=habits:1` (optional); absent → false. Cache the book list 60s in `Cache` (`books:published`).

`POST /books/:id/claim-free` JSON `{ }` (uid from header): count + insert in one `db.claimFree(uid, bookId)` transaction; returns `{ ok:true, claimed:true, remaining }`; exhausted → 409 `LIMIT_REACHED` with `remaining: 0`; re-claim of owned → 200 same. When flag false: log the claim row anyway (demand data) and return `{ ok:true, claimed:true, remaining: 3, monitor_only: true }` — never 409 in Phase 0.

Migration 002 adds the catalog `books.description` field and a `security definer` `claim_free` RPC. The RPC takes a per-user advisory transaction lock before checking the three-claim limit and inserting, so concurrent requests cannot oversubscribe the allowance.

- [x] **Step 1: Write failing tests** (fresh user catalog → all unlocked under flag false; flag true + `u_free` (3 claims) claiming 4th → 409 LIMIT_REACHED; re-claim idempotent 200).

- [x] **Step 2: Run to verify they fail.**

- [x] **Step 3: Write both routes + `Db` methods** (`listBooks`, `checkAccess`, `claimFree`) with FakeDb implementations. Test fixtures inject the minibook and dev users explicitly; the adapter has no built-in book or user data.

- [x] **Step 4: Run to verify they pass.**

Run: `deno test --allow-net supabase/functions/api/api.test.ts` — 13 tests pass. `pnpm verify:sql` applies the relational migration pieces and checks the advisory-lock guard text; the PL/pgSQL body requires the real Supabase/Postgres migration path.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/002_api_catalog_claims.sql supabase/seed/minibook.sql scripts/verify-sql.mjs supabase/functions/api/routes/catalog.ts supabase/functions/api/routes/claim.ts supabase/functions/api/lib/db.ts supabase/functions/api/api.test.ts
git commit -m "feat(api): catalog + claim-free with Phase-0 monitor mode"
```

---

### Task 4: bundle gate + 302 + ETag

**Files:**
- Create: `supabase/functions/api/routes/bundle.ts`
- Test: extend `api.test.ts`

`GET /books/:id/bundle`: `db.getBook(id)` → 404 `NOT_FOUND` if missing/draft. Access via `db.checkAccess` (+ Redis/memory `ent:{uid}:{bid}` 60s). Denied → 403 `LOCKED`. Allowed → `302` to `bundle_url` with `ETag: "v{version}"`. `If-None-Match` matching current version → `304` empty. No body bytes ever leave this function. Gate p99 budget: cache hit + PK lookups (<30ms target, asserted in e2e timing log, not unit test).

- [x] **Step 1: Write failing tests** (`u_fresh` + flag true → 403 LOCKED; `u_ent` → 302 with ETag `v1` and Location ending `bundle-habits-en-v1.json`; matching If-None-Match → 304).

- [x] **Step 2: Run to verify they fail.**

- [x] **Step 3: Write the route.**

- [x] **Step 4: Run to verify they pass.**

Run: `deno test --allow-net supabase/functions/api` — 112 tests pass (18 core route tests + 94 additional real-world cases). Redirect and `304` responses are constructed with null bodies; bundle bytes remain on the CDN. The additional matrix covers identity precedence, malformed inputs, cache isolation/expiry, multi-book catalogs, claim-limit edges, access-cache separation, ETag validators, and Supabase adapter failures. Test-only book/user data is injected through `test-fixtures.ts`; production adapters have no built-in application content.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/api/routes/bundle.ts supabase/functions/api/index.ts supabase/functions/api/lib/db.ts supabase/functions/api/api.test.ts supabase/functions/api/api.additional.test.ts supabase/functions/api/test-fixtures.ts
git commit -m "feat(api): bundle gate + CDN redirect + ETag"
```

---

### Task 5: RevenueCat webhook (verify + idempotent)

**Files:**
- Create: `supabase/functions/api/routes/webhook.ts`
- Test: extend `api.test.ts` with fixture payloads

`POST /webhooks/revenuecat`: read raw body bytes → `Authorization: Bearer <secret>` compare with `env.REVENUECAT_WEBHOOK_SECRET` via `crypto.subtle.timingSafeEqual` (missing/invalid → 401, no writes). Parse `{ event_id, app_user_id, book_id|entitlement(all_books→expand to owned set? NO — spec: single all_books entitlement; store one row per book is wrong. Decision locked: entitlements table gains row `(uid, '*')` meaning all-books; checkAccess treats `*` as unlock-all. Record this in code comment + migration note below), type }`. Idempotency: `revenue_events(event_id)` insert first (`ON CONFLICT DO NOTHING` → return 200 without re-applying). Apply: purchase/renewal → upsert entitlement; cancellation/refund/expiry → delete. Return `{ ok:true }` fast (<200ms; no RevenueCat API calls inside).

Migration note: add in Task 7's migration 002 (comment field) or treat `book_id='*'` by convention — locked: convention `book_id = '*'` = all-books, documented in code + API plan. No schema change needed.

- [x] **Step 1: Write failing tests** (bad secret → 401 + zero writes; good purchase → 200 + entitlement present; replay same event_id → 200 + single entitlement row (no dup); cancellation → entitlement gone).

- [x] **Step 2: Run to verify they fail.**

- [x] **Step 3: Write the route.**

- [x] **Step 4: Run to verify they pass.**

Run: `deno test --allow-net supabase/functions/api` — 129 tests pass (22 core route tests + 107 additional cases). All files strictly under 200 lines. Bad secrets return 401 with zero writes; purchases upsert entitlement; `all_books` maps to `*`; duplicate events return 200 without duplicate writes; cancellation/refunds remove entitlements; PostgREST ignore-duplicates headers verified.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/api/routes/webhook.ts supabase/functions/api/api.test.ts supabase/functions/api/api.additional.test.ts supabase/functions/api/index.ts supabase/functions/api/lib/ supabase/functions/api/test-fixtures.ts deno.lock plan_03_api.md
git commit -m "feat(api): revenuecat webhook verify + idempotent entitlements"
```

---

### Task 6: account + backup + requests + devices

**Files:**
- Create: `packages/builder` blob schema import (reuse Zod via npm workspace — Edge imports from `../../../../builder/src/blob.ts`; add `blob.ts` to Plan 01's package in this task's first commit if missing: `{ version: 1, books: [{ book_id, bundle_version, state, chapter_pointer, furthest_chapter, path_log_per_chapter }] }`, 1MB serialized cap check helper).
- Create: `supabase/functions/api/routes/account.ts`, `supabase/functions/api/routes/requests.ts`, `supabase/functions/api/routes/devices.ts`
- Test: extend `api.test.ts`

`POST /account { email? }`: upsert accounts row, return `{ ok:true, preserved:{claims, entitlements} }` counts (proves carry-over). Existing alias for another account → 409 CONFLICT.
`POST /account/backup`: Zod-parse blob, byte size ≤1MB (else 400 INVALID), upsert backups row. `GET /account/backup`: 404 NOT_FOUND with `{ error.code: NOT_FOUND }` when none; else blob + per-book versions. Blob newer than `?max_version=1` → 412.
`POST /requests { requested_title }`: premium check (entitlement `*` or account exists) else 403 LOCKED; trim + 1..200 chars else 400; count last 7d ≥1 → 429 RATE_LIMITED; else insert, 200.
`POST /devices/register { platform, token, locale? }`: upsert by token PK; `DELETE /devices/:token` best-effort unregister (always 200).

- [ ] **Step 1: Write failing tests** (backup roundtrip preserves bytes; oversize blob → 400; second request in 7d → 429; free user request → 403; device register + unregister 200).

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Write routes (+ blob.ts if missing).**

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/api/routes/account.ts supabase/functions/api/routes/requests.ts supabase/functions/api/routes/devices.ts builder/src/blob.ts supabase/functions/api/api.test.ts
git commit -m "feat(api): account + backup + requests + devices"
```

---

### Task 7: Push trigger + sender + local E2E

**Files:**
- Create: `supabase/functions/api/lib/push.ts`, `supabase/functions/publish-hook/index.ts` (called by `bookforge publish` after pointer swap with `{ book_id, version, previous_end }`; queries `progress` cohort, batches 500, sends)
- Create: `supabase/functions/api/e2e.local.sh`

`push.ts`: `PushSender { sendBatch(receipts: Array<{token, data}>): Promise<{ok, failed}> }`, `ExpoPushSender` (fetch to `https://exp.host/--/api/v2/push/send`, chunks of 100, auth `Expo-Access-Token` env, retries 3 with backoff on 429/5xx), `FakePush` (records). Cohort query: `progress WHERE book_id=X AND furthest_chapter >= previous_end` join devices. Revisions (same end) never trigger — enforced by requiring `version_end > previous_end` input, else no-op with `{ ok:true, sent:0, reason:"revision" }`.

`e2e.local.sh` (local stack only, asserts + timings): seed → catalog (u_fresh) → claim ×3 + 4th → expect LIMIT_REACHED under flag true → bundle 302/304 → webhook purchase → bundle 200-path → backup roundtrip → request + 429 → devices register → publish-hook dry cohort → print gate p99 from 50 bundle calls (target <30ms local). Fails (exit 1) on any mismatch. Real secrets never in repo (`.env.local` gitignored, documented in script header).

- [ ] **Step 1: Write sender + hook + script (no new unit-test file; extend api.test.ts with cohort-selection test on FakeDb: users past end included, others excluded, revision → sent 0).**

- [ ] **Step 2: Run unit tests to verify they fail, then pass after implementation.**

- [ ] **Step 3: Run the E2E script against local stack**

Run: `supabase start && supabase db reset && bash supabase/functions/api/e2e.local.sh`
Expected: ALL GREEN + gate p99 line.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/api/lib/push.ts supabase/functions/publish-hook/index.ts supabase/functions/api/e2e.local.sh supabase/functions/api/api.test.ts
git commit -m "feat(api): push trigger + sender + local E2E"
```

Plan 03 done when: `deno test` green, `e2e.local.sh` ALL GREEN on a fresh local stack, no anon-readable rows (RLS check in script), every file under 200 lines, zero secrets committed.
