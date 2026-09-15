# Prepare Algorithms (non-LLM)

Companion to `book-preparation-pipeline.md` Stages 0/3/3b/4/5 and `bundle-builder.md`. No generative LLM inside. Deterministic code + one embeddings model for similarity only. These are the algorithms the pipeline was missing between LLM calls. Cost is irrelevant; accuracy and publish-safety decide.

## 0. PM Sequence (locked)

1. Consistency patch (stale originals) — smallest, unblocks all.
2. This file (algorithms) — missing layer, blocks pipeline correctness.
3. Vendor locks (host, storage/CDN, RevenueCat products, EAS+push creds).
4. Task plans per subsystem (builder → API+push → client engine → screens → pipeline wiring → QA/release).
5. Pilot book pick (one book end-to-end before scaling).

## 1. Variable Ledger (state over time)

Single source of truth across sequential chapters: `ledger[var] = { introduced_in, type, range, display, default, chapters_touched[] }`. Rules enforced in code: first use must declare; never redefine type/range; use before `introduced_in` fails validation; defaults propagate forward only. Backward-use and silent redefinition are impossible by construction, not by prompt hope. Complexity O(vars) per chapter.

## 2. DAG Checks (per chapter, blocking)

Model decisions/options as directed graph via `next`. Run: cycle detection (iterative DFS, O(V+E)); reachability from chapter entry (BFS — flag orphan decisions); termination (every path ends at `chapter_end` within bounded steps); dead-end options (`next` target missing). Any fail blocks human review with the exact node ids. This is what guarantees "no counter needed, no stuck user" without trusting the model.

## 3. Semantic Duplicate Solver (embeddings + union-find)

Not string match. Embed every variable gloss (`label + description`) once per book with the pinned multilingual model below. Pairwise cosine: >0.85 → same-meaning candidate (block publish until reviewer merges or writes distinction); 0.70-0.85 → requires `distinction_note`, else block. Union-find clusters multi-var groups (`stress/anxiety/tension`) so chains collapse in one review action, not pairwise whack-a-mole. Embeddings model is local-only (`@huggingface/transformers`, pinned `paraphrase-multilingual-MiniLM-L12-v2` — multilingual because AR ships phase 1 and EN↔AR parity checks need one shared space; English-only MiniLM is rejected for this reason). ~120MB downloads once, cached, offline after, $0, 50-150ms per embed. Model id + version recorded in the build log; re-embed only on gloss change or model bump (bump = re-run all books' duplicate screens). API embeddings (OpenAI/Cohere) are rejected: network + keys + cost + version drift for a job where the algorithm only proposes and the human decides — local quality is sufficient at these thresholds, proven by the golden pair fixtures below. Ship `duplicates.fixtures.json` (20+ real variable pairs with expected flag/merge/keep) and fail CI if the pinned model misclassifies any. Human owns merge/keep; algorithm owns candidates.

### 3b. Model Lab (Colab / RTX 3050 — experiment here, never in the build path)

The GPU machines are the lab bench, not a pipeline stage. Purpose: pick and periodically re-prove the pinned model above.

- Lab lives in `lab/` (notebooks + eval script, never shipped, never imported by `bookforge`). Dataset: `lab/golden_pairs.json` — 40+ pairs, EN and AR mixed, each labeled `merge | flag | keep`, grown from every real reviewer override.
- Candidates: pinned multilingual MiniLM (incumbent), BGE-M3, E5-multilingual-small, EN MiniLM (baseline only). Metric: F1 on flag/merge/keep at the locked 0.70/0.85 thresholds. Constraints: CPU inference <200ms/gloss, model <500MB, offline-capable, version-pinnable.
- Pin rule: challenger replaces the incumbent only on strictly better fixture F1 with constraints met; record model id + version + date + F1 in this file and the build log. RTX 3050 4GB runs all candidates locally; Colab is the overflow bench for larger ones.
- Re-lab triggers (only these): fixtures grow by 20+ new pairs, or reviewers override threshold-borderline flags repeatedly (signal the model or thresholds drifted). Lab sessions never block a book build; the CLI always uses the pinned model on CPU. Rule shipped: same meaning → same key; real difference → separate keys with note.

## 4. Choice Meaningfulness + Balance Auditor (anti-slop core)

A decision where all options move state identically is not a decision — it is filler. Per decision per persona compute: delta vectors across options; flag if variance ≈ 0 on every var (meaningless choice) or if one option Pareto-dominates all others on every var for every persona (no tradeoff, always-correct answer — violates no-right-answer rule). Per chapter per persona compute cumulative delta sums to flag runaway personas (one persona gains +50 while others ±5 — authoring bug or favoritism). Thresholds are relative (ratios, not absolutes) so finance and habits share the code. Flags are blocking for meaningless, advisory with reviewer override for dominance (some lessons are genuinely asymmetric).

## 5. Gating Satisfiability (interval propagation, not just starting_state)

Checking `requires` against starting_state only is the static trap. Propagate reachable intervals per var through the chapter in order: start from persona `starting_state` ± accumulated min/max deltas along any path (interval arithmetic, O(decisions × vars)). Per decision per persona, prove ≥1 option satisfiable from reachable intervals; prove the always-available option (`requires: null`) exists. Fail lists the exact `(decision, persona, reachable_range vs required)` triple. This is what makes dynamic gating publish-safe with many personas.

## 6. Band Proposal Assist (algorithm proposes, Stage 3b disposes)

Thresholds from vibes are slop. From observed per-var delta distributions + declared ranges, propose 2-3 bands via 1D quantiles (33/66) seeded k-means (k≤3, 20 iterations max, deterministic seed). Output is a proposal with support stats (`n`, min/max, cut points, % of simulated random walks per band via 10k Monte Carlo walks over the DAG with uniform option sampling). Stage 3b LLM finalizes names/predicates; builder precompiles. Monte Carlo also yields difficulty signal (if 95% of random walks land `critical`, the book is punishing by construction — flag).

## 7. Coverage + Distinctness Gates

- Teaching coverage: every sim chapter `teaching_point` must own ≥1 decision whose prompt or intent references it (token overlap + reviewer confirm). Orphan teaching with no decision fails.
- Persona distinctness: pairwise `outcome_text` embedding distance per option; personas with near-identical texts across a chapter (>0.92 mean similarity) are copy-paste personas — flag for rewrite. Personas must differ in consequence, not just name.
- Placeholder hygiene: every `{var}` resolves; every tracked var is displayed at least once per chapter after its introduction (else it is phantom tracking — cut it or show it).
- Readability: Flesch-Kincaid per teaching block; flag grade >12 for a consumer book (advisory, reviewer override with note).

## 8. Build Compiler (deterministic, tested with fixtures)

Pure function `compile(canonical) → bundle`: pivot effects, precompile predicates via AST whitelist (no eval), minify v1 keys, hash. Golden fixtures per feature (gating, bands, DAG shapes) run on every change; byte-identical output for identical input (idempotent publish). Fuzz with random canonical graphs nightly to catch panics before books do.

## 9. Where Each Runs

Validation (blocks review): ledger, DAG, placeholders, satisfiability, meaningless-choice. Assist (advisory unless noted): duplicates, balance, bands proposal, coverage, distinctness, readability, Monte Carlo. Build (blocks publish): compiler + golden fixtures + size/hash gates.

## 10. Resolved Items

1. Non-LLM layer specified with thresholds and placement. Locked.
2. Backward interactions (`x4→x1`) stay future work; ledger forbids silent back-edits until that project. Locked.
3. Next: consistency patch, then vendors, then task plans, then pilot. Locked by PM call.
