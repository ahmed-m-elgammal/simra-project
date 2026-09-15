# Plan 04 — Client (Expo engine + screens + RTL proof)

> For agentic workers: implement task-by-task in order. Steps use checkbox (`- [ ]`) syntax. Do not skip tests; do not commit red. Governs: `AGENTS.md` (all 9 rules), `ux-client-design.md`, `client-expo-ux-plan.md`, `ui-screens-and-system.md`.

**Goal:** Expo app that plays any locale bundle fully offline, EN+AR from day one with RTL proof, no hardcodes, no god files.

**Architecture:** `mobile` (routes + composition) + engine (pure, jest-tested) + store/api (MMKV, FileSystem, network) + ui primitives. Engine never imports UI/network; screens never import FileSystem/MMKV/fetch directly (lint-enforced).

**Tech Stack:** Expo SDK (latest stable at build time — record version in first commit), Expo Router, Tamagui (Quiet Editorial tokens), `react-native-mmkv`, `expo-file-system`, `expo-router`, Reanimated, `@shopify/flash-list`, `@formatjs/intl` (ICU), `expo-localization`, `expo-notifications` (register only until push phase), jest + `@testing-library/react-native` (component smoke only; engine carries the logic tests).

**Layout this plan creates:**

```
mobile/app/_layout.tsx               // providers, font boot, RTL boot, device register (best-effort)
mobile/app/index.tsx                 // 1 catalog (composes only, ≤150 lines)
mobile/app/book/[id].tsx             // 4 intro + 5 personas (composes)
mobile/app/play/[book]/[ch].tsx      // 6 reading + 7 sheet + 8 outcome (composes)
mobile/app/recap/[book]/[ch].tsx     // 9 recap (composes)
mobile/app/caught-up/[book].tsx      // 10 caught-up
mobile/app/settings.tsx              // 11 settings
mobile/src/engine/*.ts               // initVar, effect, delta, band, requires, template, renderMeta, pathlog, migrate
mobile/src/engine/*.test.ts          // jest, golden fixtures (habits + finance bundles)
mobile/src/store/*.ts                // bundleCache, session, progress, settingsRow
mobile/src/api/client.ts             // catalog/claim/bundle/etag/devices/backup/requests + monitor flag
mobile/src/i18n/{en,ar}.json         // namespaced keys; missing-key test
mobile/src/i18n/index.ts             // ICU setup, locale switch + RTL reload
mobile/src/ui/primitives/*.tsx       // StatePill, OptionRow, LockNote, EmptyState, ErrorState
mobile/src/ui/sections/*.tsx         // per-screen sections (CatalogList, PersonaCards, ReadingBody, DecisionSheet, OutcomeView, RecapList, SettingsRows)
mobile/tamagui.config.ts             // Quiet Editorial tokens: paper/ink/muted/line/accent × light/sepia/dark
scripts/checks.sh                       // lint greps (hex, raw text, directional props) + missing-key check
```

---

### Task 1: Scaffold + tokens + fonts + i18n shell + RTL boot

**Files:** app scaffold, `tamagui.config.ts`, `src/i18n/*`, `app/_layout.tsx`, `scripts/checks.sh`

- [ ] **Step 1: Scaffold and install**

Run: `npx create-expo-app -t expo-template-blank-typescript mobile && cd mobile && npx expo install expo-router react-native-reanimated react-native-mmkv expo-file-system expo-localization expo-notifications expo-font @shopify/flash-list tamagui @tamagui/config @formatjs/intl`
Expected: installs clean. Record exact Expo SDK version in the commit message.

- [ ] **Step 2: Tokens (no hex anywhere else — ever)**

```ts
// tamagui.config.ts
import { createTamagui, createTokens } from "tamagui";

const tokens = createTokens({
  color: {
    paper: "#FAF7F1", paperDark: "#141311", paperSepia: "#F3EAD8",
    ink: "#1A1A18", inkDark: "#F2EFE7", inkSepia: "#2A2419",
    muted: "#6B675E", mutedDark: "#A8A29A", mutedSepia: "#7A6F5C",
    line: "#E8E2D6", lineDark: "#2E2C27", lineSepia: "#D9CBAE",
    accent: "#0F4C4C", accentDark: "#5FC0B5", accentSepia: "#0F4C4C",
    warn: "#9A6A00", warnDark: "#D9A62E", warnSepia: "#9A6A00",
  },
  space: { sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { card: 14, pill: 999 },
});
export const config = createTamagui({ tokens, themes: { light: { bg: "$paper", fg: "$ink" }, dark: { bg: "$paperDark", fg: "$inkDark" }, sepia: { bg: "$paperSepia", fg: "$inkSepia" } } });
export default config;
```

Roles only (`$bg`, `$fg`, `$muted`…); components never reference raw token names for text vs background interchangeably — bg/fg/muted/line/accent/warn roles mapped per theme.

- [ ] **Step 3: Fonts with Arabic coverage.** Load via `expo-font` in `_layout.tsx` before splash hides: UI sans (Inter for Latin) + `NotoSansArabic` fallback stack, reading serif (Newsreader for Latin) + `NotoNaskhArabic` fallback. Declare per-locale stacks `{ en: [Newsreader, serif], ar: [NotoNaskhArabic, serif] }`. Gate: render a diacritics test string in dev settings; missing glyphs (tofu □) fail QA visibly.

- [ ] **Step 4: i18n shell + RTL boot**

```tsx
// app/_layout.tsx (essentials)
import { I18nManager } from "react-native";
import * as Localization from "expo-localization";
import { loadLocale, getInitialLocale } from "../src/i18n";

const locale = getInitialLocale(); // stored pref else device (ar* → ar, else en)
if (locale === "ar" && !I18nManager.isRTL) { I18nManager.forceRTL(true); }
loadLocale(locale);
```

`src/i18n/en.json` + `ar.json` start with shell keys only (`app.name, catalog.*, settings.*` skeleton — screens add keys in their tasks, never raw text). Missing-key jest test: every `t("a.b")` key used in code exists in both files (scan `*.tsx` for `t("` via test helper). Arabic plurals use ICU selectordinal/plural with all six categories where counts appear — naive ternaries forbidden, lint-grepped.

- [ ] **Step 5: checks.sh (CI gate)**

```bash
#!/bin/sh
set -e
! grep -rn --include='*.tsx' -E '#[0-9a-fA-F]{3,8}|rgb\(|marginLeft|marginRight|textAlign: *['"'"'"]?(left|right)' mobile/src mobile/app && echo "hardcode grep clean"
node scripts/missing-keys.js  # every t("k") in en+ar, ICU-parseable
```

- [ ] **Step 6: Run + commit**

Run: `npx expo start --no-dev --minify` smoke boot to catalog shell (empty state, no network).
Expected: boots, shell renders, checks.sh green.

```bash
git add mobile src scripts
git commit -m "feat(client): scaffold + tokens + fonts + i18n shell + RTL boot (expo SDK <version>)"
```

---

### Task 2: Engine (pure, jest, golden fixtures)

**Files:** `mobile/src/engine/*.ts` + `*.test.ts`, fixtures `habits.bundle.json` + `finance.bundle.json` (hand-built tiny: 1 chapter, 1 decision, 2 options, 2 personas each — checked in).

Functions (exact signatures locked): `initVariableIfNeeded(state, variable)`, `getEffectForPersona(option, personaId)`, `applyDelta(state, delta)`, `evaluateBand(state, bandsCompiled)` (evals `fn` strings via `new Function` — ONLY place in client allowed, sandboxed to `s` param, inputs are builder-compiled from whitelist), `evalRequires(requires, state)`, `resolveOutcomeText(template, state, locale)` (Intl per value type), `renderMeta(key, value, config, locale)`, pathlog `append/rotate`, `migrateState(state, fromVersion, toConfig)` (seed new ≤ pointer, drop removed).

- [ ] **Step 1: Write failing tests** (apply delta math, band first-match, requires all/any/not, template `{var}` with ar locale number shaping, migration seeds/drops, golden playthrough: fixed choice sequence on both fixtures → exact final states asserted).

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Write engine (each file ≤100 lines logic + types; pure, no imports beyond Intl).**

- [ ] **Step 4: Run to verify they pass.**

Run: `npx jest src/engine`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/engine/
git commit -m "feat(client): pure engine + golden playthroughs habits+finance"
```

---

### Task 3: Store + API client (offline-first, monitor flag)

**Files:** `mobile/src/store/bundleCache.ts` (FileSystem `bundles/bundle-{id}-vN.json` + etag file, memory Map, keep current+previous), `session.ts` (MMKV state/pathlog/pointer per book), `progress.ts` (furthest per book), `src/api/client.ts` (fetch wrappers honoring `payments_enabled=false`: unlocked-for-all, log claims, `paywall_would_show` event on 4th-book open, ETag/If-None-Match + jittered refetch helper).

- [ ] **Step 1: Write failing jest tests** (bundleCache: store→retrieve→evict-old keeps 2; session: pathlog append/rotate/persist roundtrip; client: 304 handling via mocked fetch, jitter within 0-5min bounds).

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Write implementations** (store files never imported by ui/; screens use them only through section components' callbacks — enforced in Task 4+ review).

- [ ] **Step 4: Run to verify they pass + commit**

```bash
git add mobile/src/store mobile/src/api
git commit -m "feat(client): offline store + api client with monitor flag"
```

---

### Task 4: Screens 0–5 (catalog → persona)

**Files:** routes + `ui/sections/{CatalogList,PersonaCards}` + needed primitives + i18n keys (en+ar, native-reviewed Arabic before merge — machine Arabic never ships).

Per-screen contract (all tasks): route file composes only (≤150 lines); sections own layout (≤200); primitives shared; strings via `t()`; logical props only; direction-sensitive icons mirrored; loading/empty/error/offline states all implemented (no blank screens); EN+AR screenshots attached to the merge.

Catalog: cached shell instant → refresh badges, free pill, BookCards, claim sheet (explicit, remaining count), offline bar. Paywall route dormant behind flag (renders "Early access" variant in Phase 0). Book intro + PersonaCards (ch.1 vars only) + confirm sheet with tradeoff copy.

- [ ] **Step 1: Build catalog + claim with fixtures (mocked api client).**
- [ ] **Step 2: Build intro + personas.**
- [ ] **Step 3: checks.sh green + component smoke tests pass + EN+AR screenshots taken.**
- [ ] **Step 4: Commit per screen** (`feat(client): catalog`, `feat(client): persona select`).

---

### Task 5: Screens 6–9 (read → decide → outcome → recap)

ReadingBody (serif, state strip pills + expand, new-var unlock animation once per var), DecisionSheet (85%, swipe locked, live `lock_reason`, no counters), OutcomeView (300ms beat, haptic, pulse deltas, Continue), RecapList (FlashList, per-visited-decision blocks + collapsed siblings, Next/Replay with snapshot restore). Reanimated for sheet + pulses; no setState cascades (per-pill memo).

- [ ] **Step 1: Build with engine + store wired, airplane-mode runnable on fixtures.**
- [ ] **Step 2: Interaction proofs: tap→outcome <100ms (log in dev), no dead-end reachable on fixtures (assert via engine: every decision keeps an open option for every reachable state in random-walk test).**
- [ ] **Step 3: EN+AR screenshots (LTR+RTL, sheet, outcome, recap) + commit per screen.**

---

### Task 6: Screens 10–12 + push + backup UI + QA gates

Caught-up + bell opt-in (`devices/register` best-effort), push tap → jittered refetch → badge → resume. Settings rows (account state, backup now/restore with 412 handling, restore purchases dormant, request-a-book with 429 copy, appearance light/sepia/dark, storage sizes + clear finished, versions). System states: corrupt-bundle recovery (delete + refetch), unknown-format update prompt, offline bars.

QA gates (all green before merge): `scripts/checks.sh`, jest full, airplane-mode end-to-end on both fixtures, EN+AR screenshot set per screen, EAS dev build installs on one iOS + one Android device.

- [ ] **Step 1-3: Build, wire, prove.**
- [ ] **Step 4: EAS profiles** (`eas.json`: development, preview, production) + commit.

```bash
git commit -m "feat(client): caught-up + settings + push + backup UI"
git commit -m "chore(client): eas profiles + QA gates green"
```

Plan 04 done when: every screen ships EN+AR with screenshots, airplane-mode playthrough passes on habits + finance fixtures with zero code forks, checks.sh green, no file over its cap, no client import reaches builder/cli/workdir.
