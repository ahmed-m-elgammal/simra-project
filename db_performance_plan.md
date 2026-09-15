# DB Performance Plan

Companion to `db-and-client-architecture.md`, `api-service-layer.md`, `clarification-decisions-addendum.md`. Locks DB choices for best performance. Decisions: always-latest (no pinning), full bundle once, React Native + Expo client.

Rule preserved: same logical graph shape for every book. What varies lives in data, never in schema or client code.

## 1. Workload

- Catalog read: tiny, infrequent. Cacheable 60s.
- Bundle read: 1 heavy read per book per version. Text-only, ~200-500KB JSON per book, ~600 persona_effects max (10 chapters x 3 decisions x 4 options x 5 personas). 5 books = ~2.5MB total.
- Play: 0 server reads. Engine runs offline from bundle + in-memory path log.
- Gate check per bundle: 1 lookup by `app_user_id` in entitlements + free-claims.
- Writes: pipeline sequential, human-gated, rare. Speed irrelevant.

Conclusion: content DB must never be on the play hot path. Pre-build and edge-cache.

## 2. Stores

### 2.1 Authoring + ops: Postgres
Single Postgres (Supabase or equivalent) with PgBouncer, service_role on hot path, no RLS.

Tables:
```
books(id PK, title, author, status: draft|published, bundle_version INT, bundle_url, updated_at)
book_configs(book_id PK, state_variables JSONB, bands JSONB, bands_compiled JSONB)
personas(id PK, book_id, status, starting_state JSONB, gating_rules JSONB)
chapters(id PK, book_id, status, "order", title, content_ref)
decisions(id PK, chapter_id, book_id, "order", prompt)
options(id PK, decision_id, chapter_id, book_id, label, next, persona_effects JSONB)
entitlements(app_user_id, book_id) PK(app_user_id, book_id)
free_claims(app_user_id, book_id) PK(app_user_id, book_id)
devices(token PK, app_user_id, platform, updated_at)
progress(app_user_id, book_id, furthest_chapter, updated_at) PK(app_user_id, book_id)
requests(app_user_id, title, created_at) — 1 per user per 7 days enforced
revenue_events(event_id PK, app_user_id, book_id, type, created_at)
```

Indexes:
- `books(status)` for catalog.
- `personas(book_id, status)`, `chapters(book_id, status, "order")`, `decisions(chapter_id)`, `options(chapter_id)` covering for bundle build only.
- All gate tables are PK lookups. No secondary index needed.
- `progress(book_id, furthest_chapter)` for push targeting: who reached end-of-published.

Why not live graph DB: full-subgraph Cypher is 80-200ms cold + driver handshake + no CDN. One Postgres build at publish is 5-15ms, then zero DB on serve. Graph semantics (`Option.next` DAG) stay in data, no engine needed. If the graph name must stay per original spec, keep Neo4j for authoring only — hot path below still never touches it.

### 2.2 Serving: object storage + CDN
On Pipeline Stage 5 Publish, build one immutable file:
`bundle-{book_id}-v{N}.json` → storage (S3 / Supabase Storage) + CDN with `Cache-Control: public, max-age=31536000, immutable`, `ETag: vN`, Brotli enabled (~150KB wire).

Bundle shape is normalized for O(1) client lookup:
```
{ version, config, personasById, chaptersById, decisionsById, optionsById,
  options: { id, effectsByPersona: { pid: { delta, outcome_text } } } }
```
Builder pivots `persona_effects[]` array to `effectsByPersona` map once, so client never runs `.find()`. Minified keys. `bands_compiled: [{key, fn:"s=>s.debt<5000"}]` so `evaluateBand` is function calls, no string parser on device.

`GET /books/{id}/bundle?app_user_id=` does gate only, then 302 to CDN URL. Re-fetch uses `If-None-Match`. Old versions linger for crash recovery; pointer is `books.bundle_version`. Always-latest = bump pointer, no delta merge code.

### 2.3 Gate cache: Redis
`GET ent:{uid}:{bid}` TTL 60s in front of Postgres. Miss → prepared statement `SELECT EXISTS(entitlements) OR EXISTS(free_claims)` → fill. Webhook ingest uses `INSERT ... ON CONFLICT DO NOTHING` keyed by `event_id` for idempotent retries. Catalog response cached 60s in API memory.

Targets: gate p99 <30ms, bundle download edge-cached, play 0ms server.

### 2.4 Push targeting
Trigger from Publish. Query `progress WHERE book_id=X AND furthest_chapter >= last_published_before_N`. Batch send via Expo Push / FCM / APNs. Client re-fetch adds 0-5min jitter to avoid thundering herd; CDN absorbs spike.

## 3. Client Store (Expo + Hermes)

- Bundle JSON on FileSystem once. `JSON.parse` once (~30-50ms for 500KB), held as `Map` byId in memory.
- Running `state` + `furthest point` in MMKV (JSI sync, <1ms). No AsyncStorage bridge on hot path.
- Path log as int pairs `[decisionIdx, optionIdx]`, reset per chapter, persisted per completed chapter inside backup blob for recap restore.
- `getEffectForPersona` = hash lookup. `applyDelta` = object merge. `evaluateBand` = loop over <10 compiled fns. `resolveOutcomeText` = single regex `{var}` replace.
- Recap list via FlashList, memoized rows by `decision_id+persona_id+stateHash`. State header `useMemo` per variable, pulse via Reanimated.
- Validation is pipeline-time only (delta keys exist as of chapter, every persona covered, no same-key type drift). Zero runtime checks.

## 4. What This Supersedes

- `db-and-client-architecture.md` §3: chapter-by-chapter fetch → full bundle once, §2 point 6 version pinning → always-latest, §6.1/§6.2 resolved per above.
- `api-service-layer.md` §6.3: always latest + full re-fetch, no delta endpoint for MVP.
- `clarification-decisions-addendum.md` §3: confirms full re-fetch default.

## 5. Open Items Left

1. Backup blob version number for forward-compat.
2. Storage/CDN vendor pick (any S3-compatible works, decision does not affect shape above).
