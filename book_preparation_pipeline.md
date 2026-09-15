# Book Preparation Pipeline (LLM Workflow)

How a raw book becomes a playable simulation ready for the client bundle described in `db-performance-plan.md` and `ux-client-design.md`. Built on five decisions already made:

| Decision | Choice |
|---|---|
| Scenario sourcing | Hybrid — extract from the book's own examples where they exist, invent where they don't |
| Chapter boundaries | Flexible — pipeline can merge/split raw chapters for better simulation pacing |
| Variable timing | Incremental — new tracked variables can appear at any chapter, not just chapter 1 |
| Persona consequences | Persona-specific — same decision can have a different delta/outcome per persona |
| Orchestration | None within a chapter — one LLM call per simulation chapter, no multi-step chain |

Counts are never hardcoded. Personas, decisions, options, and variables per book are decided per book at pipeline time from that book's content. A marketing or company-teaching book may yield many personas; a dense essay may yield few. No ceilings in this spec. Quality is guarded by validation + retry, not caps.

"No orchestration" governs *within* a chapter's generation (one call, not a chain of extract→generate→refine calls). Processing chapters in order, one after another, is unavoidable sequencing — not orchestration — because each chapter's call needs to know what the config and personas look like *so far*. Two book-level exceptions exist: segmentation gate (Stage 1, human) and bands synthesis (Stage 3b, one call after the last chapter). Both are locked below.

## 1. Pipeline Stages

```
Stage 0: Ingest raw book text (code, no LLM)
Stage 1: Segmentation pass   → defines simulation chapters + teaching_point per chapter → HUMAN GATE, locked before Stage 2
Stage 2: Persona pass        → generates the persona set for the whole book (count decided per book)
Stage 3: Per-chapter pass    → ONE call per simulation chapter, run in order, chapter N+1 sees chapter N's approved output
Stage 3b: Bands synthesis    → ONE call after the last chapter, writes evaluation_bands precompiled
Stage 4: Human review gate   → per chapter, before publish (judgment only, mechanics already checked)
Stage 5: Publish + bundle    → status: draft → published, deterministic code builder compiles CDN bundle, push fires if live book grows
```

### Stage 0 — Ingest (code, no LLM)
Strip headers/footers/page numbers. Keep raw chapter markers with source offsets for traceability. Output: `raw_chapters[{id, title, char_count, offsets}]`. Pipeline blocks until rights to derive simulation content are manually confirmed. No assumption about licensing status is made here.

### Stage 1 — Segmentation (one call, whole book) → HUMAN GATE
Input: full raw text with chapter markers intact.
Output: ordered `sim_chapters[{order, title, source_ranges[], rationale, teaching_point}]`. `teaching_point` is one line per sim chapter and is reused in every Stage 3 call to keep invented scenarios on-topic. Each raw chapter must be covered exactly once across all `source_ranges`; code checks this plus title uniqueness before any human sees it.

Gate: a human approves the full `sim_chapters` list before Stage 2 starts. Rationale: a bad split poisons decisions, variables, and personas downstream; catching it here avoids reworking all chapters. Once approved, segmentation is locked. Reopening it later requires an explicit structural flag and may invalidate already-approved chapters.

```json
{ "sim_chapters": [
    { "order": 1, "title": "...", "source_ranges": ["raw_ch_1"], "rationale": "stands alone", "teaching_point": "..." },
    { "order": 2, "title": "...", "source_ranges": ["raw_ch_2", "raw_ch_3"], "rationale": "raw ch. 2 is two pages with no distinct teaching point; merged into ch. 3", "teaching_point": "..." }
]}
```

### Stage 2 — Persona generation (one call, whole book)
Input: full book text (or summary) + locked `sim_chapters` + book teaching goal (one line).
Output: persona set decided per book (2 or more; count follows the book, not a quota), each `{persona_id, name, description, starting_state}`. `starting_state` seeds only variables anticipatable now (best effort, not a lock). Description freezes at approval and is never rewritten by later stages.

Backfill rule: when chapter N introduces variable `x4` and personas hold `x1,x2,x3`, the pipeline adds `state[x4] = default_value` at chapter N entry. Decisions from N onward may read/write `x1–x4`. Chapters 1..N-1 outcomes, recaps, and persona descriptions stay frozen. No backward recomputation. Cross-variable backward effects (`x4` reinterpreting `x1` history) are future algorithmic work, explicitly out of this version.

### Stage 3 — Per-chapter generation (one call per simulation chapter, sequential)
Input: this chapter's source text (from `source_ranges`) + current `BookConfig.state_variables` + full persona list + book teaching goal + prior sim chapter titles.

One pass decides:
1. **Sourcing (hybrid):** extract a concrete example/exercise if present (with source quote), else invent a scenario exercising `teaching_point`.
2. **New variables:** reuse an existing key whenever meaning overlaps. New keys only for genuinely new tracking. Each carries `{key, label, type, range, display, default_value, introduced_in_chapter: N, distinction_note}`. `distinction_note` is required when similarity to any existing var exceeds the Stage 4 threshold.
3. **Decisions + options:** count decided per chapter from content (typically 1-2 decisions, 2-3 options each; the book decides, no fixed quota). Each option carries `{label, intent, next, requires, lock_reason}`.
4. **Gating (dynamic, not static):** `requires` is `null` (always available) or `{all:[{var, op, value}]}` evaluated by the client against live state at render time. `lock_reason` is a human sentence with the threshold ("Needs Energy ≥ 4"). Static locked-persona lists are not used: they go stale once state evolves and feel scripted. Every decision keeps at least one option with `requires: null` so no persona ever hits a dead end.
5. **Persona-specific effects:** per option, one `{delta, outcome_text}` per persona. `outcome_text` is 40-70 words, contains at least one `{var}` placeholder that exists as of this chapter, and carries no raw numbers outside placeholders (numbers live in `delta`).
6. **Recap hint:** per persona, one line summarizing the state reached; full recap is assembled client-side from sibling `outcome_text`s, no extra generation.

Output shape (per chapter, canonical — human-readable, not minified, not compiled):
```json
{
  "sourcing": { "mode": "extract|invent", "quote": "..." },
  "new_variables": [ { "key": "...", "label": "...", "type": "...", "range": [".", "."], "display": "bar|number|currency|percent", "default_value": "...", "distinction_note": "..." } ],
  "decisions": [
    { "prompt": "...",
      "options": [
        { "label": "...", "intent": "...", "next": "decision_id|chapter_end",
          "requires": null,
          "lock_reason": "...",
          "persona_effects": [
            { "persona_id": "...", "delta": {"...": "..."}, "outcome_text": "... {var} ..." }
          ]
        }
      ]
    }
  ],
  "recap_hints": [ { "persona_id": "...", "hint": "..." } ]
}
```
This maps onto `Chapter → Decision → Option` canonical nodes. It is not the serving bundle. A deterministic code builder (Stage 5) compiles serving artifacts; the LLM never writes minified keys or compiled lambdas.

### Stage 3b — Bands synthesis (one call after the last chapter)
`evaluation_bands` are not written incrementally: early guesses without the full variable ranges churn and invalidate reviewed chapters. After the last chapter is approved, one call sees the complete variable list, observed delta ranges, and teaching goal, then writes `bands[{key, predicate}]` (2-3 bands per book, predicates as data). The Stage 5 builder precompiles these to client evaluators. No per-chapter band design.

### Stage 4 — Human review (per chapter, judgment only)
Reviewer checks: invented scenario on `teaching_point`? New var genuinely needed (or merge per duplicate flags)? Deltas believable per persona? `requires` thresholds fair with readable `lock_reason`? At least one always-available option per decision? Placeholders resolve? Nodes stay `status: draft` until approval.

Rework rule: Reject re-runs this chapter's Stage 3 only, with the reviewer note appended plus the rejected output as a negative example. Mechanical validation failures auto-retry with the error injected, max 2 auto-retries before escalating to human. Human-triggered re-runs are unlimited until approve; each carries the chapter's rejection history. Reject never cascades to segmentation or prior chapters unless the reviewer raises an explicit structural flag.

### Stage 5 — Publish + bundle (code, deterministic)
Approved chapter nodes flip `draft → published`. Version pointer `books.bundle_version` bumps. Code builder (no LLM): validates once more, pivots `persona_effects[]` to `effectsByPersona` maps, normalizes to `byId` maps, precompiles bands + `requires` predicates, minifies keys, Brotlis, uploads immutable `bundle-{book_id}-v{N}.json` to storage + CDN, updates `bundle_url`. Serving follows `db-performance-plan.md`: gate check then CDN redirect, full re-fetch on new publish. If the book is already live and this publish extends it, push fires to caught-up users only (from `progress` table).

## 2. Automated Checks Before Human Review

Code runs these before any chapter reaches a reviewer; fail blocks review and triggers the Stage 4 retry path:
- Every `delta`, `starting_state`, `requires`, and `{placeholder}` key exists in accumulated `BookConfig` as of that chapter.
- Every persona has a `persona_effects` entry for every option (no skipped personas, however many the book chose).
- No same-key `type`/`range` drift across chapters.
- `requires` predicates reference existing vars with in-range thresholds; every decision has ≥1 option with `requires: null`.
- `next` graph is acyclic per chapter and terminates at `chapter_end`.
- Semantic duplicate screen: embed every new var vs existing; similarity >0.85 flags for merge review with side-by-side glosses; >0.70 requires `distinction_note`. Merge rewrites delta keys to the existing key. Final merge/keep call is human. Rule: same meaning → same key; real difference → separate keys.

## 3. Why Sequential Processing, Not Orchestration

Stage 3 runs chapter 1, then 2, then 3, because each call needs the accumulated config — otherwise `stress` fragments into `stress_level`. This is ordering, not orchestration. Orchestration (splitting one chapter into extract→deltas→text chains) remains out of scope. Segmentation gate, bands synthesis, and the code builder are the only cross-chapter steps, each locked above.

## 5. CLI Contract (`bookforge` — how books actually get made)

The pipeline is driven as a CLI so the operator (human or any LLM agent) only ever supplies the book PDF; every stage is a re-runnable command over a `workdir/` of strict-JSON state. No stage runs without its inputs present; every command exits non-zero with a machine-readable error on failure.

```
bookforge init    book.pdf --workdir ./mybook --locale en     # scaffold workdir + bookforge.config.json (book meta, thresholds, no book-specific code)
bookforge ingest  --workdir ./mybook                          # Stage 0 → raw_chapters.json
bookforge segment prompt --workdir ./mybook                   # Stage 1 → prompt pack for the driving agent (context + schema + constraints)
bookforge segment submit --file out.json --workdir ./mybook   # validate + store sim_chapters.json (proposed); errors are machine-readable for agent self-correct
bookforge segment approve --workdir ./mybook                  # HUMAN GATE: locks sim_chapters.json (or `request-changes --note "..."` → new prompt pack)
bookforge personas prompt --workdir ./mybook                  # Stage 2 → prompt pack
bookforge personas submit --file out.json --workdir ./mybook  # validate + store personas.json + teaching_goal.txt
bookforge chapter prompt --n 3 --workdir ./mybook             # Stage 3 → prompt pack (chapter text + current ledger + personas + prior approved chapters)
bookforge chapter submit --n 3 --file out.json --workdir ./mybook  # validate + store chapters/03.json
bookforge chapter approve --n 3 --workdir ./mybook            # HUMAN GATE per chapter (approve | request-changes --note "..." → new prompt pack, history kept)
bookforge bands prompt --workdir ./mybook                     # Stage 3b → prompt pack (full ledger + delta ranges + Monte Carlo stats)
bookforge bands submit --file out.json --workdir ./mybook     # validate + store bands.json
bookforge validate --workdir ./mybook                         # all Stage 4 checks incl. DAG, ledger, duplicates, satisfiability
bookforge build   --workdir ./mybook                          # deterministic compile → bundle-mybook-en-vN.json (+ .br/.gz, sha) — NO network, NO keys
bookforge publish --workdir ./mybook --dry-run                # snapshot check against DB, prints what would flip
bookforge publish --workdir ./mybook                          # Stage 5: flip draft→published, upload CDN, bump version, fire push targeting
```

Rules: there is deliberately NO LLM API setup — no provider flag, no `LLM_API_KEY`, no per-call billing. The generation step is performed by whatever agent drives the CLI (OpenCode session, CLI agent, web agent): the CLI assembles a prompt pack (full context + JSON schema + constraints + prior approved outputs), the agent thinks and writes the structured output, the CLI validates it. Generation commands therefore come in pairs — `prompt` emits the pack, `submit` validates and stores (or returns machine-readable errors the agent self-corrects from, no human needed for mechanical failures). `--format json` for agent-driven runs (strict JSON on stdout, human summary on stderr); interactive TTY gets the review UI (side-by-side diffs, gloss comparisons for duplicates, approve/reject). `build` and `validate` never touch the network. State files are the resume mechanism — re-running a chapter reads prior approved chapters only, never unapproved drafts.

Separation (hard boundary): the workdir never leaves the operator machine except through `publish`, which uploads approved immutable bundles only. Drafts, rejected outputs, prompt packs, notes, and raw book text are never uploaded to public storage, never committed under client paths, never compiled into the mobile app. The client cannot address anything in this filesystem by construction.

Helper repos (locked — assemble, don't rebuild): `unjs/unpdf` (PDF text extraction, zero-dep, Node/edge), `unjs/citty` (CLI subcommands, zero-dep, lazy load), `@clack/prompts` (approve/reject review UI, spinners, progress), `@huggingface/transformers` sentence-similarity locally (pinned multilingual `paraphrase-multilingual-MiniLM-L12-v2` — EN+AR shared space, offline, no API cost — duplicate + distinctness checks), `dagrejs/graphlib` (cycle detection/toposort for `next` graphs), `simple-statistics` (quantiles for band proposals, Monte Carlo stats), `zod` (canonical schemas), `vitest` (goldens + fuzz). Hand-written IP stays small: stage prompts, validators' thresholds, interval-propagation satisfiability, Monte Carlo walk, balance auditor.

## 4. Resolved Items (kept — see §5 for how each runs in the CLI)

1. **Segmentation review** — human approves `sim_chapters` before Stage 2/3. Locked.
2. **Persona backfill** — mechanical defaults only; description frozen; no backward recompute; backward interactions are future work. Locked.
3. **Cost/output size** — no ceilings; book decides counts; validation + retry guards quality. Locked.
4. **Duplicate variables** — reuse by default, embedding flags + distinction notes, human merge/keep. Locked.
5. **Bands origin** — final synthesis call (Stage 3b), precompiled at build. Locked.
6. **Gating origin** — dynamic `requires` per option in Stage 3, evaluated live on device. Locked.
7. **Publish shape** — canonical nodes from pipeline; serving bundle compiled by code. Locked.
8. **Rework scope** — chapter-scoped re-run with note + history; 2 auto-retries; unlimited human re-runs; no cascade without structural flag. Locked.
