# API / Service Layer

Scope: this is the client-facing API only. Authoring/review has its own separate internal service (already decided) and isn't covered here. Content serving follows `db-performance-plan.md` (gate + CDN redirect, never live graph queries) and `bundle-builder.md` (immutable versioned bundles). Push follows `clarification-decisions-addendum.md` §2 (notify caught-up users on extension only).

## 1. Governing Principles

- **The client never asks the server to compute a decision's outcome.** Once a book's bundle is downloaded, the client runs the generic engine (apply delta / evaluate band / resolve outcome text) fully offline. This API gets fully-authored, fully-validated content onto the device — never computes during play.
- **No account required for base play.** Identity defaults to anonymous. A real account only exists if/when a user opts into premium backup.
- **RevenueCat is the entitlement source, not this API.** Apple/Google handle purchase; RevenueCat validates receipts cross-platform. This API trusts RevenueCat webhooks + a local mirror table, never reimplements verification.
- **Content is immutable and edge-cached.** `GET /bundle` checks a tiny gate (entitlements + claims) then redirects to CDN. No graph traversal on the hot path.
- **Always-latest, full re-fetch.** No version pinning, no delta endpoint for MVP. Re-fetch returns the newest published bundle; clients send `If-None-Match`.

## 2. Identity Model

- RevenueCat auto-generates an anonymous `app_user_id` on first launch. This API adopts it as its identity key. No second ID system.
- On backup opt-in, SDK identify/login aliases anonymous → identified. This API records account ↔ identity mapping; free-claims and entitlements carry over.
- All client calls send `app_user_id` (header `X-App-User-Id` preferred, query accepted for `GET /bundle`). No session cookies for base play.

## 3. Core Endpoints

Error envelope for all error responses: `{ ok: false, error: { code, message } }` with HTTP status. Codes: `LIMIT_REACHED, LOCKED, NOT_FOUND, INVALID, RATE_LIMITED, CONFLICT, ABORTED`. Successful JSON responses use `{ ok: true, ...data }`; redirects and `304` responses have no JSON envelope.

### `GET /catalog`
Returns book list. Response per book: `{ id, title, description, price_tier: free_eligible|paid, unlocked_for_me: bool, bundle_version, has_update: bool }`. `unlocked_for_me` = free-claimed OR entitled. Computed from `free_claims` + `entitlements` PK lookups + 60s Redis cache. Response cached 60s server-side. No auth beyond `app_user_id`.

### `POST /books/{id}/claim-free`
Body: `{ app_user_id }`. Idempotent via `free_claims(app_user_id, book_id)` PK (`ON CONFLICT DO NOTHING` returns already-claimed as success). Enforces max 3 free per `app_user_id` in one transaction (count + insert). Success `200 { claimed: true, remaining }`. Exhausted `409 { error: LIMIT_REACHED, remaining: 0 }`. Rate limit: 10/min per user. Free claims are our logic, not RevenueCat purchases. Reinstall resets anonymous id and its 3 claims — accepted for MVP, not solved here.

### `GET /books/{id}/bundle?app_user_id=...`
Gate: `302` only if free-claimed OR entitled, else `403 { error: LOCKED }`. On pass: `302` to immutable CDN URL `bundle-{id}-vN.json` with `ETag: vN`. Client re-fetch sends `If-None-Match`; server/CDN returns `304` when current. No body larger than the redirect comes from the API itself. `has_update` in catalog derives from comparing device-known version vs `books.bundle_version`.

### `POST /webhooks/revenuecat`
Verifies signature on every call (missing/invalid → `401`, no state change). Idempotent on RevenueCat `event_id` (`revenue_events` PK, `ON CONFLICT DO NOTHING`). Handles purchase/renewal/cancellation/refund via upsert/delete on `entitlements(app_user_id, book_id)`. Returns `200 { ok: true }` fast; never blocks bundle delivery on RevenueCat live API. Retries safe by idempotency.

### `POST /account` (premium only)
Body: `{ app_user_id, email|oauth_token }`. Creates account, records anonymous → identified alias. Carries existing free-claims/entitlements/progress. `409 CONFLICT` if alias already exists for another account (manual resolve, no auto-merge).

### `POST /account/backup` / `GET /account/backup` (premium only)
Requires account. Body (upload): `{ version: 1, books: [{ book_id, bundle_version, state, chapter_pointer, furthest_chapter, path_log_per_chapter }] }`. `path_log_per_chapter` preserves recap history, not just numbers. Size cap 1MB per user. `GET` returns newest blob + `bundle_version` per book so client can detect stale state after always-latest migration. `412` if blob version newer than client supports.

### `POST /requests` (premium only)
Body: `{ app_user_id, requested_title }`. Requires premium (entitlement or account check per API spec). Trims title to 200 chars, 1 per user per 7 days (`429 RATE_LIMITED` beyond). Stores for team review. No simulation logic.

### `POST /devices/register`
Body: `{ app_user_id, platform: ios|android, token }`. `token` is PK, upserts owner. Required for push. Unregister on logout/reinstall via token delete (best effort). No account required — ties to anonymous id like entitlements.

## 4. Push Notifications

- Trigger: Pipeline Stage 5 Publish when a chapter is newly published for a book with users past the previous end-of-content (extension only; revisions never push).
- Targeting: `progress WHERE book_id=X AND furthest_chapter >= previous_end`. Batch via Expo Push / FCM / APNs at 500/ticket. Payload: `{ book_id, bundle_version: N }`, no content body.
- Client: tap → `GET /bundle` full re-fetch with 0-5min jitter. CDN absorbs herd. Badge "New chapter ready" until opened.

## 5. What This API Deliberately Does Not Do

- No per-decision outcome endpoint — on-device engine only.
- No payment processing — Apple/Google/RevenueCat own it; webhook consumer only.
- No mandatory login for base play.
- No authoring/review endpoints — separate internal service.
- No live content-DB graph queries on play paths — gate + CDN only.

## 6. End-to-End Flow

> Phase 0 per `monetization-plan.md`: `payments_enabled=false` — gate returns unlocked for all, claims are logged but never block, no paywall shown. Flip to `true` via remote flag when traction thresholds hit; no endpoint changes needed.

1. Install → RevenueCat SDK mints anonymous `app_user_id` → `POST /devices/register`.
2. `GET /catalog` → lock states + free counter.
3. Claim up to 3 via `POST /claim-free` → `GET /bundle` (302 CDN) → offline cache.
4. 4th book → native RevenueCat paywall → webhook → entitlements → `GET /bundle`.
5. Play 100% offline; progress + path log on device (MMKV + files).
6. Backup opt-in → `POST /account` (alias) → `POST /backup` uploads blob.
7. New chapter published → push to caught-up → tap → full re-fetch `GET /bundle` (new ETag) → resume.

## 7. Open Items

1. Free-claim reinstall reset — accepted for MVP. Not tied to store account in this version.
2. Entitlement source — webhook-fed local table + Redis. Locked (no live RevenueCat check per bundle request).
3. Bundle updates — always latest + full re-fetch + ETag. Locked. No delta endpoint for MVP.
4. Webhook signature verification — required on every call; verify before any write.
