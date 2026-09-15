# Client UX + Engine Design

Companion to `interactive-book-simulation-spec.md`, `db-and-client-architecture.md`, `api-service-layer.md`, `book-preparation-pipeline.md`, `clarification-decisions-addendum.md`.

Locked for this doc: mobile app, React Native + Expo. Client stays small — lookup + arithmetic only, no runtime LLM. Full UX defined here. Monetization: 3 free claims on anonymous `app_user_id`, rest via RevenueCat. Versioning: always-latest, no pinning — re-fetch migrates forward.

Core rule carried over: app and DB are adaptive to any book category. No finance-specific code or copy. Everything book-specific comes from `BookConfig.state_variables` + `evaluation_bands`. Client iterates config, renders `display: bar | number | currency | percent`.

## 1. Core Loop

### 1.1 Reading surface
Calm book-first layout. Serif teaching text, one concept per screen. Top state strip is quiet — pills for each variable that exists as of current chapter, rendered from `BookConfig`. Tap expands to full bars/numbers. Strip grows only when a new variable unlocks.

New variable unlock (e.g. chapter 3 introduces `energy`): strip slides in one new pill + one-time explainer line ("Now tracking Energy — late nights drain it") seeded from `default_value` via `initVariableIfNeeded`. Persona select never shows future vars. Recap for a chapter shows only vars that existed at that chapter.

### 1.2 Decision point
No quiz chrome. No radio buttons, no Submit, no green/red, no score preview, no "decision 2 of 4" (chapter is a DAG via `Option.next`, path length varies).

Teaching text ends on tension. Inline card ("What do you do?") + persona nudge opens a bottom sheet, 85% height, swipe-down disabled until choice. Sheet keeps reading context behind.

Sheet anatomy:
- Prompt in persona voice, 1-2 lines.
- 2-4 options as story actions with 1-line intent subtext. No delta numbers, no hints.
- Gated option (per `Persona.gating_rules`): visible, dimmed, lock icon + human reason ("Requires savings — you have none"). Not tappable. Teaches starting-reality gap; hiding it would hide the lesson.
- Deltas never shown before pick to prevent min-max gaming.

### 1.3 Pick and outcome
Tap → light haptic → options collapse, chosen expands. 300ms pause, then outcome story appears as continuation — `resolveOutcomeText(effect.outcome_text, state)` with live values filled. `applyDelta` + `evaluateBand` already ran locally from bundle data. State pills pulse once with floating `+2 / -4`, then settle.

`evaluation_bands` never render as grades ("BAD"). Band change shows as quiet dot tone shift + wording inside outcome text.

No undo. Back disabled at this moment. Double-tap blocked. Choice appends `{decision_id, chosen_option_id}` to in-memory path log (reset per chapter). Fully offline — all siblings already in bundle payload.

### 1.4 Chapter-end recap
Scroll, not a modal. One block per decision in path log, in order:
- What you chose + 1-line outcome.
- Collapsed "What else could've happened" → sibling `outcome_text`s for that decision.

Then final state summary in plain language + band implication, no grade. CTA: Next Chapter (state carries over) or Replay Chapter (reset to chapter-start snapshot, with confirm). Replay clears that chapter's path log segment.

## 2. Catalog, Claim, Persona, Paywall

### 2.1 Catalog and 3-free claim
No login wall on first run. List from `GET /catalog`: title, description, `price_tier`, `unlocked_for_me`. Header pill shows free counter ("3 free included" → "2 left").

Free book tap → explicit sheet: "Claim this book? Free X of 3 left after this. Downloads once for offline." [Claim and Download] / Cancel. Calls `POST /books/{id}/claim-free`. No silent burn on accidental tap.

After claim → `GET /books/{id}/bundle` full graph once (config + all personas + all published chapters). Real progress by chapter. Then Start enabled. Bundle cached for offline play; no further network needed for play.

### 2.2 Paywall
4th book tap → native RevenueCat paywall (Apple/Google sheet, not custom). Copy: "You've used 3 free. Unlock all books." Purchase → `POST /webhooks/revenuecat` updates entitlements table → `unlocked_for_me` flips → bundle downloads. Settings has Restore Purchases. Free-claim abuse via reinstall is accepted for MVP (anonymous id resets) — flagged, not solved here.

### 2.3 Book start and persona select
Intro screen: book teaching goal in 2 lines + "You'll play one life start to finish." Persona cards (3-5 from pipeline): name, 2-line story, mini pills for chapter-1 vars only (dynamic keys from `starting_state`, rendered via `renderVariable`). No future vars, no spoilers.

Tap → confirm sheet restating tradeoff in that book's terms ("Starts low Energy — some options will lock") → `starting_state` copied to local `state`. One persona per run. Switching persona restarts book with confirm.

## 3. Caught-Up, Push, Re-fetch

Book may be live incomplete (`Book.status: published` = live with what's published). Final published chapter end shows "You're caught up. Next chapter cooking." + bell opt-in. `POST /devices/register {app_user_id, platform, token}` ties token to anonymous id, no account needed.

Pipeline Stage 5 Publish fires push only to users whose furthest point reached end-of-published for that book. Tap → full re-fetch `GET /books/{id}/bundle` (always-latest, no delta endpoint for MVP) → "New chapter ready" badge + resume. Mid-book users on revision migrate forward silently per always-latest decision.

## 4. Backup, Restore, Request a Book

Progress is on-device by default. Settings shows "On this device."

Premium backup: `POST /account` creates real account, SDK aliases anonymous → identified, claims/entitlements carry over. Then `POST /account/backup` uploads blob, `GET /account/backup` restores. Blob must contain `{book_id, state vector, chapter pointer, furthest point per book, path log per completed chapter}` so recap history restores, not just numbers. Version field for forward-compat.

`POST /requests {app_user_id, requested_title}`: premium-only per API spec. One text field + submit, logged for team review. No simulation logic. Server enforces 1 request per user per 7 days for MVP.

## 5. Technical Notes (client only)

- Engine: same six functions for every book — `initVariableIfNeeded, getEffectForPersona, applyDelta, evaluateBand, renderVariable, resolveOutcomeText`. No book-specific branches.
- Bundle is source of truth after download. No per-decision fetch. No live RevenueCat check per bundle request — webhook-fed table only.
- Path log is the recap input. Persist path log per completed chapter inside backup blob if recaps must survive restore.
- Gating evaluated locally from `Persona.gating_rules` against live `state` at decision render time.
- `content_ref` teaching text ships inside bundle for MVP (offline reading). No separate CMS fetch.
- Open items left for build: bundle cache invalidation wording on always-latest re-fetch, backup blob version number.
