# UI Screens and Design System

Companion to `ux-client-design.md` and `client-expo-ux-plan.md`. Planning only. Covers every screen from app icon tap, plus the design system decision.

## 1. Design System Decision

None of Material 3, HIG-alone, Carbon, or Ant Design fits as the app system. Verdict per candidate:

- **Material 3:** Android-expressive, FABs, tonal surfaces, loud motion. Built for Google apps and dense actions. Wrong tone for calm reading; fights the book feel.
- **HIG (alone):** principles only (clarity, deference, depth), iOS-only. Principles align, but it is not a cross-platform component system and we ship Android too.
- **Carbon:** IBM enterprise dashboards — data tables, dense forms. Completely wrong for consumer simulation.
- **Ant Design:** admin consoles — tables, filters, heavy chrome. Wrong tone and weight.

**Locked: custom Quiet Editorial system on native foundations.** Take accessibility + touch + motion fundamentals from HIG/Material (44pt targets, 4.5:1 text contrast, 200-300ms ease-out, haptics on consequence), but all tokens and reading components are bespoke: the app is a book first, software second. Implementation in Expo via Tamagui (tokens + optimizing compiler for Hermes performance) with a fixed token set below. No per-book theming — neutral paper/ink so finance, habits, and relationships all fit.

Tokens:
- Type: Serif reading (e.g. Newsreader) for teaching/outcomes/recap story; Sans UI (e.g. Inter) for labels, buttons, pills. Scale: Title 24/32 serif, Body 17/27 serif, UI 15/22 sans, Caption 13/18 sans. Never gamified display type.
- Color (light default): paper `#FAF7F1`, ink `#1A1A18`, muted `#6B675E`, line `#E8E2D6`, accent ink-teal `#0F4C4C` (actions + progress), warn amber `#9A6A00` (band shifts, never red/green grades). Dark + sepia reading themes reuse the same roles.
- Shape/motion: radius 14 cards / full pills, 1pt lines, soft shadow only on sheets. Sheet slide 260ms ease-out, pill pulse 400ms, no bounce, no confetti.
- State visuals: driven by bundle `display` — `bar` (thin track + fill + value), `number/currency/percent` (tabular numerals). Deltas float `+2/−4` in muted, never green/red.

## 2. Screen Inventory (tap icon → every screen)

### 0. Splash → boot
Branded paper splash (name + mark, no spinner art). Cold boot renders cached shell <300ms; no login wall; no onboarding carousel for MVP. First-run goes straight to Catalog with the free pill explained inline.

### 1. Catalog (home)
Header: wordmark + free pill ("3 free" → "2 left" → "Premium"). List: BookCards (cover block, title, 1-line promise, meta `N chapters • ~M min • P personas`, badge `Free • claim / Owned / Premium / Update`). States: cached shell + refresh, offline bar, empty (no books → Retry),Scroll preserves position. Tap free → Claim sheet (§2). Tap owned → resume at pointer or Book intro if fresh. Tap premium/locked → paywall.

### 2. Claim sheet (modal)
"Claim this book? Free X of 3 left after this. Downloads once for offline." Buttons [Claim & Download] / Cancel. Progress replaces buttons on confirm (chapter counts + bytes, cancellable before finish only). `409 LIMIT_REACHED` swaps to paywall copy inline. No silent burn.

### 3. Paywall (native RevenueCat sheet + fallback screen)
Native store sheet first. Fallback screen only if native dismissed: "You've used 3 free. Unlock all books." + [Unlock] + Restore Purchases link. Errors show store message verbatim. Success auto-starts bundle download.

### 4. Book intro
Cover, 2-line teaching goal, "You'll play one life start to finish." Meta + Download state if needed. CTA [Choose your starting point] → personas. Secondary: switch book.

### 5. Persona select
Vertical PersonaCards: initial avatar, name, 2-line story, mini pills for chapter-1 vars only (dynamic from bundle). No future vars, no spoilers. Tap → confirm sheet restating tradeoff in that book's words ("Starts low Energy — some options lock") + [Start] / Back. Confirm writes session; switching later = destructive restart confirm.

### 6. Chapter reading
Top StateStrip (quiet pills, tap expands bars). Body: serif teaching screens, paging scroll, chapter title + progress as "Chapter N of M" (chapter counts are fixed; decision counts are not). Foot: inline "What do you do?" card at each decision point → opens Decision sheet. New-var unlock inserts pill + one-line explainer once. Offline indicator only if bundle missing (shouldn't happen post-download).

### 7. Decision sheet (bottom sheet, 85%)
Prompt (persona voice) → options (label + intent, no numbers) → gated rows dimmed with lock + live `lock_reason`. Swipe-down locked until choice. No counter, no grades. Error state: all-locked violation (builder prevents; client unlocks first + logs).

### 8. Outcome view (sheet morph)
Chosen expands → 300ms beat → outcome story (resolved `{vars}`) + pills pulse deltas → [Continue]. Back disabled. Double-tap blocked. Appends path log.

### 9. Chapter recap (scroll)
"How your chapter went": per visited decision — chosen + 1-line outcome, collapsed siblings ("What else could've happened"). Then final state summary + band implication in words. CTAs: [Next Chapter] (carry state) / Replay Chapter (restore snapshot, confirm). FlashList rows memoized. Empty path (skipped chapter impossible by DAG) → fallback summary only.

### 10. Caught-up (end of published)
"You're caught up. Next chapter cooking." + bell opt-in + [Back to library]. Badge on book when push lands ("New chapter ready"). Tap push/deep link → re-fetch → resume.

### 11. Settings
Rows: Account ("On this device" vs email), Backup [Back up now] + last time, Restore Purchases, Request a book (1 field + limit note), Appearance (Light/Sepia/Dark), Storage (bundle sizes + Clear cache for finished books), Versions (app + bundle_format + per-book vN), About. States: upload/download progress, `412` newer-blob → update prompt, `429` request limit.

### 12. System states (global)
Offline bar (cached content works, fetches queue), corrupt bundle recovery screen (delete + re-fetch + Retry), forced update (unknown format), push permission priming inline at caught-up screen only (never at boot).

## 3. Navigation Map

`index(catalog) → book/[id](intro→personas) → play/[book]/[ch](read→sheet→outcome) → recap/[book]/[ch] → play[next] | caught-up[book]`. `settings` modal from catalog header. Paywall interrupts `catalog→claim` and `locked→bundle` edges only. Deep link `book/{id}?v=N` from push lands on catalog badge → play at pointer.

## 4. Resolved Items

1. System: custom Quiet Editorial on Tamagui; Material/Carbon/Ant rejected with reasons above; HIG principles borrowed, not adopted as system. Locked.
2. Every screen specified with states; no screen left as assumption. Locked pending your review.
3. No per-book theming or hardcoded book UI. Locked.
