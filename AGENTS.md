# AGENTS.md — Interactive Book Simulation App

Read this file first on every session. No code until the plan for that task is approved. Specs are the source of truth; chat is not.

## 1. Read Order (every session)

1. This file.
2. `book_preparation_pipeline.md` + `prepare_algorithms.md` (how books are made).
3. `db_performance_plan.md` + `bundle_builder.md` (data + publish path).
4. `api_service_layer.md` (gate + CDN + push contract).
5. `ux_client_design.md` + `client_expo_ux_plan.md` + `ui_screens_and_system.md` (feel + screens).
6. `interactive_book_simulation_spec.md`, `db_and_client_architecture.md`, `clarification_decisions_addendum.md` (originals; where a new file contradicts an original, the new file wins and the original gets patched — never the reverse).

Stack: React Native + Expo (Hermes), Expo Router, Tamagui (tokens + compiler), MMKV + FileSystem, Reanimated, FlashList, RevenueCat SDK, Expo Push. Postgres + storage + CDN server-side.

## 2. Golden Rules (violations block merge)

1. **No hardcoded colors.** Every color comes from Tamagui tokens (`paper, ink, muted, line, accent`). No hex/rgb literals in components. New color → add token + both light/dark/sepia roles first.
2. **No hardcoded themes.** Light/sepia/dark via token roles only. No per-book theming. No inline `StyleSheet.create` colors; use tokens.
3. **No hardcoded strings.** Every user-facing string is an i18n key with EN + AR values from day one. No raw text in JSX, including errors, empty states, lock reasons, accessibility labels, push copy. Book content ships per-locale in the bundle (see §3), never embedded in code.
4. **No directional hardcodes.** No `left/right`, `marginLeft`, `textAlign: left`. Use logical props (`start/end`, `textAlign: 'start'`) so Arabic RTL mirrors free. Icons that imply direction (arrows, chevrons, progress) must flip under RTL — use `scaleX` mirror or RTL-aware assets, verified in both directions.
5. **No book-specific branches.** No `if (book==='finance')`, no variable names (`debt`, `stress`) in code, no persona names in code. Engine iterates bundle config only. A new book category must run with zero code change.
6. **No live content queries on play paths.** Client plays from cached bundle + memory. Server play path is gate + CDN redirect only.
7. **No model-written machine artifacts.** LLM output stays canonical/human-readable. Compiled lambdas, minified keys, hashes come from deterministic code only.
8. **No god files.** Every screen is composed of small components; no screen file owns data-fetching + engine + layout + styles at once (see §6).
9. **Authoring filesystem is separate from the mobile build.** The `bookforge` workdir (PDFs, raw text, drafts, prompt packs, notes, rejected outputs) lives on the operator machine / internal service only. It is never committed under client paths, never bundled into the app binary, never uploaded to public storage. Only immutable published bundles reach the CDN; the app reads its own cache dir only. A client import reaching into `builder/`, `cli/`, or any workdir path fails review automatically.

## 6. Component / File Rules (every screen)

- One file, one job: screen files own composition + navigation only. Data access lives in `store/` + `api/`, math in `engine/`, visuals in `ui/` components. A screen importing FileSystem, MMKV, and fetch directly is a violation.
- Size caps (hard): screen file ≤150 lines, component file ≤200 lines, hook ≤100 lines. Over the cap → split before merge, no exceptions for "just this once".
- Split pattern per screen: `Screen` (route, composes) → section components (`CatalogList`, `PersonaCards`, `ReadingBody`, `DecisionSheet`, `OutcomeView`, `RecapList`, `SettingsRows`) → primitives (`StatePill`, `OptionRow`, `LockNote`, `EmptyState`, `ErrorState`). Shared primitives live in `ui/primitives`; screen-specific parts colocate in the screen's folder, never duplicated across screens.
- Props flow down, events flow up. No cross-component MMKV/FileSystem reads; components receive data + callbacks. Engine functions are pure and UI-free so both EN and AR render paths share them.
- Each component renders in both LTR and RTL and both locales with the same props (locale-blind props; strings arrive already localized). New component → stories/screenshots EN+AR before merge.
- Quick check addition: any new screen file over 150 lines or any component importing both storage and network fails review automatically.

## 7. Confusion Protocol (read, ask, never hide)

- **Read before act.** Before touching code, read the governing MDs for the task and name them in your first reply. Never answer from memory when a spec exists — open the file. If the file doesn't cover it, say "not in the specs" explicitly.
- **Ask on any confusion.** Ambiguous, contradictory, or missing spec → stop and ask with your best recommendation first. Guessing silently is a violation, even if the guess is right. One question at a time; each question states what you checked and what is unclear.
- **Never hide confusion.** Say "I'm unsure about X" in plain words. No hedging filler ("probably fine", "should work"), no presenting unchecked claims as facts. Distinguish checked (file + line or test output) from inferred.
- **Contradictions surface immediately.** If two MDs disagree, or code disagrees with an MD, report both sides with paths and stop — do not pick a side quietly (§1 order decides only after you surface it).
- **No fake done.** "Done" requires the §5 evidence attached (lint output, tests, screenshots, fixture runs). "Works on my machine" without the checks is not done. If a check can't run, say which and why instead of skipping silently.
- **Out-of-scope findings go to a list, not into the change.** Found something broken nearby? Report it separately; don't expand the task without approval.

## 3. i18n / l10n (EN + AR first, DE/IT later — architected now)

- Locales phase 1: `en` (LTR), `ar` (RTL). Phase 2 (no re-architecture): `de`, `it`, more. All infrastructure ships phase 1.
- Framework: ICU MessageFormat via FormatJS (or equivalent) — required because Arabic has 6 plural categories (`zero, one, two, few, many, other`); naive singular/plural `if` statements are forbidden.
- Strings: keys namespaced per screen (`catalog.claim.title`, `decision.lockedReason`, `recap.siblings`, `settings.backup.now`). Every key has `en` + `ar` before merge. Missing-key lint fails CI. Reviewer checks Arabic copy with a native reader before release — machine-only Arabic never ships.
- Numbers/dates/currency/percent: `Intl` with active locale only (`Intl.NumberFormat(locale)`, tabular numerals for state values). Never `toFixed` + hardcoded `$`/`%`. Currency code comes from bundle var metadata, formatted per locale.
- RTL: `I18nManager` driven at boot from locale; force re-render on switch. QA matrix runs every screen in EN-LTR and AR-RTL (screenshots both). Sheet gestures, recap lists, state strip order, and progress direction all mirror. Numbers with placeholders inside Arabic sentences keep logical order via ICU args, never string concatenation.
- Fonts: reading serif + UI sans must both ship Arabic-capable faces (test glyph coverage for AR diacritics). Fallback stack declared per locale, verified on device.
- Book content: bundles are per-locale (`bundle-{book}-{locale}-vN.json`). Pipeline produces EN first, AR second with human review (translation is a Stage 3-class pass, not an afterthought). Engine is locale-blind: same `delta` math, same predicates; only displayed strings swap. `lock_reason`, `outcome_text`, prompts, persona copy, teaching text all come from the locale bundle. Cross-locale parity check (same decision/option/persona ids, same var keys, same DAG) blocks publish.
- Push copy, paywall copy, error copy: localized server-side (locale stored with device token) or client-rendered from keys — decided per message in the API plan, never hardcoded English fallback except as last-resort key echo in dev.

## 4. Session Workflow

1. Restate the task + which MDs govern it. If the task contradicts an MD, stop and ask — do not silently reinterpret specs.
2. Ask before assuming (open questions get asked one at a time, best-recommendation-first, never slop A/B/C without reasoning).
3. Plan in MD (same folder, same pure-technical style) and get approval. Then implement task-by-task with tests; engine changes need fixture proof (golden bundles, DAG cases, RTL screenshots EN+AR).
4. Update the governing MD when behavior changes — specs stay true or the change doesn't land.
5. Definition of done: no hardcodes (lint: colors, strings, directional props), EN+AR strings + RTL screenshots, offline airplane-mode pass, no dead-end decision reachable, bundle format checks green, MDs updated.

## 5. Quick Checks Before Any Commit

- `grep` for hex colors, raw JSX text, `marginLeft|marginRight|textAlign:\s*['"]left|right` outside Tamagui/logical props — must be empty.
- New user-facing copy → `en` + `ar` entries present, ICU-valid, plural-complete for Arabic.
- New screen → EN + AR screenshots attached to the change.
- Engine change → golden-fixture tests + a habits-book and a finance-book bundle both still play with zero code forks.
