# Client Build Plan (Expo + UX)

Companion to `ux-client-design.md`, `db-performance-plan.md`, `bundle-builder.md`, `api-service-layer.md`. Planning only, no code. Stack locked: React Native + Expo (Hermes), Expo Router, Reanimated, FlashList, MMKV (JSI sync) + FileSystem (bundles), RevenueCat SDK, Expo Push. Any-book rule holds: zero book-specific branches in code; all meaning comes from bundle config.

Starters/helpers (locked — assemble, don't rebuild): `yarn create tamagui@latest --template expo-router` (official Tamagui + Expo Router starter from `tamagui/tamagui` — tokens, compiler, dark-mode wiring), `react-native-mmkv` (sync state store), `@shopify/flash-list` (recap lists), `react-native-purchases` (Phase 1 only, dormant until the money flip), `RevenueCat/revenuecat-expo-replit-framework` (reference for paywall wiring in Phase 1 — copy patterns, not the template). Hand-written IP: engine 6 functions, Tamagui Quiet Editorial tokens, i18n keys EN+AR, screen/section components per `ui-screens-and-system.md`.

## 1. Project Structure

```
app/
  _layout.tsx            // providers, theme, boot (load MMKV, register device token best-effort)
  index.tsx              // catalog (GET /catalog, free counter, claim sheets)
  book/[id].tsx          // book intro + persona select (chapter-1 vars only)
  play/[bookId]/[chapterOrder].tsx  // reading surface + state strip + decision sheet host
  recap/[bookId]/[chapterOrder].tsx // chapter-end multi-fork recap
  caught-up/[bookId].tsx // end-of-published + bell opt-in
  settings.tsx           // backup/restore, restore purchases, request-a-book, versions
src/
  engine/  // getEffectForPersona, applyDelta, evaluateBand(compiled fns), renderMeta(lookup display), resolveOutcomeText, initVariableIfNeeded, evalRequires(compiled), pathLog helpers
  store/   // bundleCache(byId maps in memory + FileSystem), session(state+pathLog in MMKV), progress(furthest per book), settings(account/premium)
  api/     // catalog, claimFree, bundleFetch(302+ETag+If-None-Match+jitter), devicesRegister, backup up/down, requests, revenuecat wiring (paywall + restore)
  ui/      // StateStrip, DecisionSheet, OutcomeView, RecapList, PersonaCard, BookCard, PaywallHost, Empty/Error states
```

Each module owns one job with a typed interface; engine never imports UI or network.

Boundary (hard): the app package imports engine/api/ui only. It never imports `builder/`, `cli/`, or any authoring workdir path, and reads nothing outside its own cache dir + MMKV. The only content entering the app is versioned CDN bundles. Enforced by package boundaries + lint; violations fail review per `AGENTS.md` rule 9.

## 2. Data Shapes (device)

- Bundle (memory): `{ format:1, book_id, version, config{vars[], bands_compiled[{key,fn}]}, personasById, chaptersById, decisionsById, optionsById{effectsByPersona, requires_compiled, lock_reason} }`. Parsed once per book version via `JSON.parse`, held in `Map`s. Reject `format!=1`.
- Session (MMKV): `{ book_id: { persona_id, state{...}, chapter_pointer, path_log_current[{d,o}], path_log_done{chapterOrder:[{d,o}]}, bundle_version } }`. `state` keys exactly config vars as of pointer. Path entries are int indexes, not UUIDs.
- Progress (MMKV + server mirror on backup): `{ book_id: furthest_chapter }` for push targeting + resume.
- Files: `bundles/bundle-{id}-vN.json` + `.etag`. Keep current + previous version only; delete older on successful migration.

## 3. Flows In Detail

### 3.1 Boot → catalog
Cold boot reads MMKV (<20ms), renders cached catalog shell instantly, then `GET /catalog` refreshes badges (`unlocked_for_me`, `has_update`). Header free pill ("3 free" → "2 left") from claimed count. Free tap → claim sheet (explicit Claim & Download / Cancel, remaining shown) → `POST /claim-free` → on `200` start bundle fetch with real per-chapter progress (parse streaming counts, not fake %). `409 LIMIT_REACHED` → route to paywall. Paid/locked tap → RevenueCat native sheet → webhook flips entitlement → auto-retry bundle. Offline catalog shows cached list with "Offline" bar; bundle fetch queued.

### 3.2 Persona select (progressive disclosure)
Book intro: teaching goal 2 lines + "one life start to finish". Persona cards: story + mini pills for chapter-1 vars only (via `renderMeta`), never future vars. Confirm sheet restates tradeoff in that book's terms. Confirm → copy `starting_state` to `state`, clear path logs, set pointer to ch.1, persist. Switch persona = restart book with destructive confirm. Switching bundle version mid-run migrates forward (always-latest): keep `state`, seed new vars at their `introduced_in_chapter <= pointer` with defaults, drop removed-var keys (log for debug, never crash).

### 3.3 Chapter play + state strip
Reading surface: serif body, one concept per screen, paging scroll. State strip top: quiet pills per live var (label + compact value per `display`: bar/number/currency/percent). Tap expands bars. New-var unlock at chapter entry: strip inserts pill with 400ms slide + one-line explainer, once per var per run. `initVariableIfNeeded` seeds defaults silently otherwise.

Decision trigger: inline "What do you do?" card → bottom sheet 85% height, swipe-down locked until choice. Sheet: prompt (persona voice), 2-4 options (label + intent, no numbers), gated rows dimmed with lock + `lock_reason` resolved with live numbers. `evalRequires` runs on live `state` at sheet open and after every prior decision (eligibility can change mid-chapter via DAG path). Guarantee: ≥1 option always tappable (builder enforces; client asserts and, on violation, unlocks first option and logs — never dead-ends).

Pick: haptic light → collapse others → 300ms beat → outcome view (story continuation with resolved `{vars}`) + state pills pulse floating deltas then settle + band dot tone shift (no grades). Append `{d,o}` to current path log, persist. Back/swipe disabled until Continue. All synchronous from memory; no network, no spinners.

### 3.4 Recap (full path, not last decision)
Scroll built from `path_log_current`: per decision in order — chosen + 1-line outcome, collapsed siblings ("What else could've happened" → sibling `outcome_text`s). Then final state summary in plain language + band implication. CTA Next Chapter (carry `state`, rotate path log current→done) or Replay Chapter (restore chapter-start snapshot, clear current log, confirm). Recap rows memoized by `decision+persona+stateHash`, FlashList with `getItemType`.

### 3.5 Caught-up + new chapter
End of published (not book-complete): "You're caught up" + bell opt-in (registers `devices/register` if needed). Push `{book_id, version}` → on tap: `GET /bundle` with `If-None-Match` + 0-5min jitter → badge + resume. Revision of old chapters: silent migrate on next open, no push.

### 3.6 Settings: backup, restore, requests, purchases
"On this device" vs account state. Upgrade → `POST /account` alias → auto `POST /backup` (blob ≤1MB: state + pointers + furthest + path_log_done + versions). New phone → `GET /backup` → rehydrate + rebuild recaps from path logs (no server compute). Restore Purchases button calls RevenueCat restore → refresh catalog. Request-a-book: one field, premium-gated client-side with server `429` fallback.

## 4. Edge and Failure States (all specified, none crash)

- Locked bundle `403` → paywall route with book context. Offline bundle fetch → queued retry with progress resume. Corrupt bundle (parse/hash fail) → delete file, full re-fetch, error screen with Retry (never half-state). Unknown `bundle_format` → force re-fetch, prompt app update if persists. All-options-locked (shouldn't happen) → unlock first + log. Empty catalog / no books → illustrated empty with Retry. Web paywall errors → surface RevenueCat message verbatim, no custom copy. Backup `412` (blob newer) → prompt app update before overwrite. Out-of-storage on download → abort before partial write with cleanup.

## 5. Performance and Quality Bars

- Boot to cached catalog <300ms; `JSON.parse` 500KB once ~30-50ms; decision tap → outcome <100ms (memory only); 60fps sheet + pulse via Reanimated (no setState cascades; per-pill `useMemo`). Recap 100+ rows via FlashList, no FlatList. Images: text-only MVP, no image pipeline. Hermes bytecode + `expo-updates` for JS OTA (content still via bundle versions, never OTA). EAS builds per store; RevenueCat entitlement check cached, never per-decision.

## 6. What This Plan Does Not Include

No runtime LLM, no chat, no quiz scoring, no per-decision network, no book-specific code, no delta-merge updater (full re-fetch only), no authoring UI (separate internal service).

## 7. Acceptance Checklist (build is done when)

Catalog counter correct after 3 claims; 4th routes paywall; bundle downloads once then plays airplane-mode end-to-end; persona shows ch.1 vars only with in-context unlock later; gated rows show live reason; pick→outcome <100ms with pulse; recap lists every visited fork with siblings collapsed; replay resets cleanly; caught-up bell → push → badge → resume; backup restores recaps on second device; corrupt bundle recovers via re-fetch; no dead-end decision reachable.
