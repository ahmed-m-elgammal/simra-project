# Bundle Builder (Publish → CDN)

Companion to `book-preparation-pipeline.md` Stage 5 and `db-performance-plan.md` §2.2. Deterministic code, no LLM. Takes canonical published nodes, returns an immutable client-ready bundle on CDN. The pipeline writes human-readable canonical; this builder compiles serving artifacts. The LLM never writes minified keys or compiled lambdas.

**Stack (locked): TypeScript package + Supabase Edge Function (Deno) wrapper.** `compile(canonical) → bundle` is a pure, dependency-free TS function in a versioned package — same language as the Expo client, shared Zod schemas for canonical/bundle validation, tested with Vitest golden fixtures (byte-identical output) plus fuzz. It runs two places: (1) locally/CI for tests and dry-runs, (2) inside a thin Edge Function at publish that reads the snapshot via service role, calls `compile`, uploads to Storage/CDN, swaps the pointer. Build <2s for 500KB fits Edge limits comfortably. No second vendor, no always-on server, zero idle cost.

Helper repos (locked — assemble, don't rebuild): `zod` (schemas), `dagrejs/graphlib` (DAG proofs), `simple-statistics` (band stats), `@huggingface/transformers` (duplicate/distinctness embeddings, local), Node built-ins `zlib` (Brotli/gzip) + `crypto` (sha256) — no dep for compression/hashing, `supabase-js` (Storage upload + snapshot read in the publish wrapper), `vitest` (goldens + fuzz). Hand-written IP: pivot/normalize, predicate precompiler (AST whitelist), minify key map v1, hash + idempotency.

## 1. Input

Single read-only transaction snapshot at publish time:
- `books` row (id, `bundle_version` N, status)
- `book_configs` (state_variables, bands as data)
- `personas` where `status=published` (starting_state, gating base)
- `chapters/decisions/options` where `status=published`, ordered
- Per option: `label, intent, next, requires` (data, nullable), `lock_reason`, `persona_effects[{persona_id, delta, outcome_text}]`, teaching text via `content_ref`

Fail the build if the snapshot is empty or any referenced id is missing. Never publish a partial bundle.

## 2. Build Steps

### Step 1 — Validate (blocks publish)
Re-run all Stage 4 checks on the snapshot plus cross-chapter checks: every `next` target exists or equals `chapter_end`; every `persona_id` in effects is a published persona; every `{placeholder}`, `delta` key, and `requires` var exists in config; every decision keeps ≥1 option with `requires: null`; bands reference existing vars with in-range thresholds. Fail → no version bump, no upload, return error list to pipeline review. Pass → continue.

### Step 2 — Normalize to byId maps
Pivot arrays to maps for O(1) client lookup. No nested scans on device:
```
config, personasById, chaptersById, decisionsById, optionsById
options[id].effectsByPersona = { pid: { delta, outcome_text } }  // pivoted from persona_effects[]
chapters[id].decisionIds[] in order; decisions[id].optionIds[] in order
```

### Step 3 — Precompile predicates (safe, no eval)
`requires` language is data-only: `{all:[{var, op, value}]}` / `{any:[...]}` / `{not:{...}}`, ops `==,!=,<,<=,>,>=`. Bands are `{key, all/any}` over vars. Builder compiles each to a lambda string from a fixed template (e.g. `s=>s.energy>=4`), never `eval()` of model text. Reject unknown ops/vars. Client evaluates function calls only. Ship both data form (audit) and compiled form (runtime); client uses compiled.

### Step 4 — Minify keys (fixed map, versioned)
Fixed key map under `bundle_format: 1`: `d=delta, o=outcome_text, r=requires, l=lock_reason, e=effectsByPersona, v=state_variables`. Map lives in this file; bumping the map bumps `bundle_format` and forces full re-fetch (old clients reject unknown format). Reviewers never see minified form; only the builder output does.

### Step 5 — Serialize, compress, hash
Emit `bundle-{book_id}-v{N}.json` (minified) + `.br` + `.gz`. Compute `sha256` and byte sizes. Reject if uncompressed >2MB or any `outcome_text` missing a `{var}` (quality gate). Record `{version, sha, sizes, built_at, source_snapshot}` in a build log table for audit.

### Step 6 — Upload immutable + pointer swap
Upload to storage + CDN with `Cache-Control: public, max-age=31536000, immutable`, `ETag: vN`, `Content-Encoding: br` variant. Files are immutable; never overwrite `vN`. Atomically update `books(bundle_version=N, bundle_url)` only after upload succeeds. Re-running the same snapshot yields the same hash and skips upload (idempotent).

CLI mapping: Steps 1-5 run as `bookforge validate` + `bookforge build` (local, no network, no keys — any agent or human runs them); Steps 6-7 run as `bookforge publish` (needs service key; `--dry-run` first). Full command contract lives in `book-preparation-pipeline.md` §5.

### Step 7 — Push on extension
If this publish extends a live book (new chapter beyond previous end-of-published), query `progress WHERE book_id=X AND furthest_chapter >= previous_end` and enqueue push (Expo/FCM/APNs batch). New/changed revision of existing chapters does not push (always-latest migrates silently on next open). Client re-fetch uses `If-None-Match: vN` with 0-5min jitter.

## 3. Output Shape (serving)

```
{ format: 1, book_id, version: N, sha,
  config: { vars: [...], bands_compiled: [{key, fn}] },
  personasById: { pid: { name, desc, start } },
  chaptersById: { cid: { order, title, text, decisionIds[] } },
  decisionsById: { did: { prompt, optionIds[] } },
  optionsById: { oid: { label, intent, next, r_compiled, lock_reason,
    e: { pid: { d: {...}, o: "..." } } } } }
```

## 4. Failure and Edge Handling

- Validation fail → publish blocked, version untouched, prior CDN files serve. No partial rollout.
- Upload fail after DB pointer swap is impossible by order: upload first, swap second.
- Concurrent publishes for one book serialize on `books(id)` row lock; loser re-reads snapshot and rebuilds as N+1.
- Client with stale `vN-1` keeps playing offline; next open re-fetches full `vN`. No delta merge code in MVP.
- Rollback = pointer swap back to `vN-1` (files retained). No delete.

## 5. Performance Targets

- Build <2s for a 500KB book on a single worker. Gate check p99 <30ms (Redis + PK lookup). Bundle wire ~150KB via Brotli. Client parse once ~30-50ms, then RAM-only play.
- Push fan-out batched at 500/expo ticket; jittered re-fetch lets CDN absorb herd.

## 6. Resolved Items

1. Pipeline writes canonical; builder compiles serving. Locked.
2. Predicates are data compiled by fixed templates, never model-written code. Locked.
3. Immutable versioned files + DB pointer; rollback by pointer. Locked.
4. Push only on extension, never on revision. Locked.
