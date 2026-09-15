# Monetization Plan (best net profit, payments deferred)

Companion to `api-service-layer.md` (§3 claim/paywall, §7). Planning only. Decision locked: **do not ship payments now.** Ship free + instrumented; turn money on only after real user data. All money code paths are designed below so the flip is a flag, not a rewrite.

## 1. Phases

### Phase 0 — Free + measurement (now until traction)
- `payments_enabled=false` (remote flag, default false). All books `unlocked_for_me=true`. No claim limits enforced, no paywall UI, no RevenueCat SDK in the binary.
- Gate code ships in monitor-only mode: claim/free-count logic runs and logs, never blocks. Every 4th-book open logs `paywall_would_show` with book id — this is the demand signal that later sets price and timing. No fake paywall shown; users just read. Deception costs reviews, which cost profit.
- Founding framing in copy (not a paywall): "Early access — everything free for founding readers." Builds goodwill + reviews while free.

### Phase 1 — One-time all-unlock (flip when thresholds hit)
- Flip `payments_enabled=true` via remote config — no app update (gate + claim code already shipped). Then add RevenueCat SDK + one `all_books` product in a single small release (~1 day: SDK, paywall sheet wiring, restore, webhook already spec'd).
- Offer: single one-time "Unlock everything, including future books." Launch price test: $9.99 vs $14.99 vs $19.99 (RevenueCat paywall A/B; price on value, never on the ~$20/book LLM cost).
- Grandfather: anyone active in Phase 0 keeps everything free forever (flag on `app_user_id`). Cost ≈ zero (content is cheap), buys reviews and word-of-mouth — the highest-ROI marketing at this stage.

### Phase 2 — Subscription (only when earned)
- Conditions (all three): catalog ≥15 books, monthly release cadence held 3+ months, Phase 1 buyers finishing ≥3 books on average. Until then subscription stays off the roadmap.
- Shape: monthly/annual "new simulations every month" tier; one-time unlock remains purchasable (never remove it — removing it burns trust). Early one-time buyers get 1 free year, then keep their lifetime unlock regardless.

## 2. Net-Profit Math

- Unit cost per book: ~$10-20 LLM + reviewer hours (low hundreds all-in). 5-book launch catalog ≈ a few hundred dollars total.
- Break-even at $14.99: ~30-50 buyers cover all content + infra for a year. Everything after is margin for catalog speed.
- Store fees: enroll Apple Small Business + Google 15% tier before first dollar (<$1M revenue) — 15% vs 30% is the single biggest profit lever, one form each, do it during Phase 0.
- RevenueCat: free tier to start; paid tier only when webhook volume justifies it. Supabase/EAS stay on free/cheap tiers until MAU forces upgrades. Fixed costs ≈ $100/yr Apple + ~$0-30/mo infra.
- Growth is the margin engine: review prompt after each book finish (organic installs, $0 CAC), founding-readers goodwill, fast catalog from the cheap pipeline. Paid ads only after Phase 1 conversion data proves LTV > CAC — never before.

## 3. Instrumentation (ships in Phase 0)

Events (anonymous id): `book_opened, book_finished, persona_picked, paywall_would_show, recap_expanded, push_opened, backup_opt_in_tap`. Funnel that flips the switch: weekly `paywall_would_show` count + % of users finishing 3 books. Suggested flip thresholds: ≥500 MAU with ≥8% finishing 3+ books, or ≥100 `paywall_would_show`/week sustained 4 weeks — whichever first, then PM confirms. Thresholds are defaults; the data can move them.

## 4. What Changes in Other MDs (recorded, not yet built)

- `api-service-layer.md`: add `payments_enabled` flag semantics (false = gate returns unlocked, still logs claims). No endpoint changes.
- `client_expo_ux_plan.md`: paywall screen ships dormant behind the flag; catalog badges show "Early access" variant in Phase 0.
- Nothing in bundle/engine/pipeline changes for money. Money is a gate flag + one entitlement, never content logic.

## 5. Resolved Items

1. Model: one-time all-unlock first, subscription only when earned. Locked.
2. Ship order: free + instrumented now, money later on data. Locked.
3. Grandfathering: Phase 0 actives free forever. Locked.
4. Fee posture: 15% small-business tiers before first dollar. Locked.
