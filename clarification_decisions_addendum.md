# Clarification Session — Decisions & Addendum

Companion to `interactive-book-simulation-spec.md`, `db-and-client-architecture.md`, `api-service-layer.md`, and `book-preparation-pipeline.md`. This doc resolves five forks that were ambiguous or contradictory across those four files, and flags what each resolution changes.

## 1. Decisions Made

| # | Question | Decision | Supersedes |
|---|---|---|---|
| 1 | How does chapter content reach the client? | **Full bundle, downloaded once per book** (`GET /books/{id}/bundle`) | `db-and-client-architecture.md` §3's read-workflow table, which described a chapter-by-chapter fetch. That table needs a rewrite — config + all chapters arrive in one payload, not fetched per chapter-start. |
| 2 | Can decisions branch within a chapter? | **Yes** — `Option.next` can route different options to different next decisions, so a chapter's decisions form a small DAG, not a straight line. | Any assumption of a fixed decision count per chapter. Progress UI can't say "decision 2 of 4" — the number of decisions hit depends on the path taken. |
| 3 | Can a book launch before every chapter is authored? | **Yes** — `Book.status: published` means "live with whatever's published so far," not "complete." | Nothing explicit before, but this makes the versioning open item (`db-and-client-architecture.md` §6.1) two separate cases: *revising* existing published content (needs pinning so a mid-book user isn't moved onto a changed graph) vs. *appending* new chapters after some users have finished the available content (simpler — no pinning conflict, just new nodes). |
| 4 | How does the client learn a book has new chapters? | **Push notification on new publish.** | New system component — see §2 below. Directly answers `api-service-layer.md` §6.3 ("does bundle always serve latest") in favor of: yes, latest, and the client is told when to go get it rather than polling. |
| 5 | How much does the chapter-end recap cover? | **Every fork along the path taken**, not just the last decision's siblings. | `interactive-book-simulation-spec.md` §8 step 5 and the "Chapter-End node" description in §7 assumed a single decision's worth of siblings. Now it's a multi-section recap: one "what else could've happened here" block per decision visited that chapter. |

## 2. New Component: Push Notifications

Not present in any existing doc. Minimum shape needed:

- **Device token registration** — a new endpoint, e.g. `POST /devices/register { app_user_id, platform, token }`. Ties to the existing anonymous `app_user_id`, same pattern as the entitlements table — no account required.
- **Notification targeting** — recommend notifying only users who have **already reached the end of currently-published content** for that book, not everyone who owns it. Requires the backend to know a user's furthest-reached point per book (see §4 below — this overlaps with the backup blob).
- **Trigger point** — fires from Pipeline Stage 5 (Publish) when a chapter is newly published for a book that already has users past the previous end-of-content point.

## 3. Bundle Re-fetch on Notification

Open sub-question this raises: when a user taps the notification, does the client re-call `/books/{id}/bundle` in **full** again, or does the API need an incremental/delta fetch (e.g., "chapters after N")?

**Default recommendation:** full re-fetch, same endpoint, no delta mechanism. `api-service-layer.md` §3 already frames the bundle as "the only heavy payload in the API," and text-only book content is unlikely to be large enough at 4–5 launch books to justify a second fetch mode. Flag this to revisit only if book length or catalog size grows enough that re-downloading the whole graph for one new chapter becomes wasteful.

## 4. Recap Path Log — No Backend Change Needed

Since the full chapter subgraph (all decisions, all options, all sibling outcome texts) is already local after the bundle download, building the multi-fork recap is a **client-side-only** concern:

- Client keeps an in-memory path log — `[{decision_id, chosen_option_id}, ...]` — reset at each chapter start, appended on every decision made.
- At chapter-end, the client walks that log and assembles the sibling outcome text for each entry. No new graph nodes or queries required.

**Knock-on effect for the backup blob** (`api-service-layer.md` §3, `/account/backup` — format still open per `db-and-client-architecture.md` §6.4): if restored progress should reproduce recap history and not just current state, the blob needs to store the **path log per completed chapter**, not just the final state vector + current chapter pointer. Worth deciding when the blob format gets defined.

## 5. Docs That Need a Follow-Up Edit

- `db-and-client-architecture.md` §3 — rewrite the read-workflow table for full-bundle-upfront instead of chapter-by-chapter fetch.
- `db-and-client-architecture.md` §7 (Chapter-End node description) and `interactive-book-simulation-spec.md` §7/§8 — update "sibling option outcomes" language to reflect full-path recap, not single-decision siblings.
- `api-service-layer.md` — add the device-registration endpoint and note the notification trigger; §6 open item 3 can be marked resolved (references this doc).
- `db-and-client-architecture.md` §6.1 (versioning) — split into "revision" vs. "extension" sub-cases per decision #3 above.
