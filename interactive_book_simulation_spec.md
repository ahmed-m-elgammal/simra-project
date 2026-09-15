# Interactive Book Simulation App — Spec

## 1. Vision

Not a digital copy of a book. A simulation layer built on top of a book's content, where the reader makes decisions as a persona inside the book's world, sees the consequences of those decisions play out, and learns by comparing what happened against what could have happened. Launches with 4–5 pre-configured books, each with its own isolated simulation. No in-app chat, no runtime AI. Learning-by-consequence, not quiz-and-grade.

## 2. Core Concept

- User opens a book, picks a **persona** (a pre-defined starting state — e.g., a specific budget, debt load, life situation).
- Moves through the book **chapter by chapter**.
- Within a chapter, the book's teaching content is interspersed with **decision points** — not right/wrong questions, but choices with consequences.
- Each decision changes the persona's underlying state (numbers, conditions).
- At the **end of each chapter**, the user sees: the outcome of the path they took, and what the outcome would have been for the option(s) they didn't pick (local counterfactual).
- State **carries forward** into the next chapter — nothing resets.
- Each book is a fully isolated simulation. No cross-book state, no shared persona.

## 3. Confirmed Assumptions

These were not explicit in the original ask; they're the defaults chosen to make the rest of the system coherent. Flag any of these to change and the dependent sections below get redrawn.

| # | Assumption | Why |
|---|---|---|
| 1 | Consequences are computed via a **state vector + deltas**, not a static pre-written text tree | This is what makes it feel dynamic rather than scripted, and is the actual "evaluation function" borrowed from minimax-style thinking |
| 2 | "See other outcomes" means the **local counterfactual** (sibling options at the same decision point), not a full alternate playthrough of the rest of the chapter | Full branching is combinatorial content to author with zero LLM fallback at runtime — not sustainable at scale |
| 3 | State **persists across chapters** within a book | Resetting every chapter would make persistent consequence meaningless |
| 4 | Persona sets **starting state values AND can gate which options are even offered** (e.g., no savings → no "invest in stocks" option) | Matches "different personas, different starting reality" |
| 5 | A **human reviews each LLM-generated chapter package** before publishing to the database | Recommended for accuracy on financial/educational content; open for the product owner to override |

## 4. Explicit Non-Goals

- **No LLM/AI inference at runtime, on-device or server-side, during user sessions.** All intelligence is pre-computed at authoring time.
- **No chat feature.** No RAG layer, no conversational assistant inside the app.
- **No rigid quiz format.** No single "correct answer" scoring.
- **No PostgreSQL / relational store as primary DB.** Data model is graph-shaped (see §7).
- **No cross-book state or shared personas.** Each book's simulation is a closed system.

## 5. High-Level Architecture

Two clearly separated halves:

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│   OFFLINE AUTHORING PIPELINE │  ──────▶│         GRAPH DATABASE         │
│  (LLM + code, human review)  │  writes │   (books, chapters, personas,  │
│   Run once per book/chapter  │         │    decisions, options, deltas) │
└─────────────────────────────┘         └──────────────┬───────────────┘
                                                          │ reads only
                                                          ▼
                                          ┌──────────────────────────────┐
                                          │        CLIENT APP RUNTIME     │
                                          │  Simulation engine (no LLM)   │
                                          │  State vector + lookup logic  │
                                          └──────────────────────────────┘
```

The client never calls an LLM. Everything it needs is pre-baked and retrieved from the graph DB.

## 6. Offline Content Pipeline (per chapter)

1. **Ingest** the chapter's raw text.
2. **LLM: extract core teachable concept(s)** for that chapter.
3. **LLM + code: generate decision points** — 2–4 options per decision, each option tagged with:
   - A **state delta** (e.g., `debt: -500`, `stress: +2`, `savings_rate: +0.05`)
   - An **outcome narrative** (short, human-readable consequence text)
4. **LLM: generate the persona set** — done once per book, not per chapter. Each persona is a starting state vector plus any option-gating rules.
5. **LLM: generate chapter-end recap content** — summarizes the path taken, and pulls the stored outcome text for the sibling options not chosen (local counterfactual).
6. **Human review gate** — an editor reviews the generated decision/outcome/delta package for accuracy before publish. (Assumption 5 — confirm if this stays manual, semi-automated, or is dropped.)
7. **Publish** — structured nodes and edges are written to the graph database.

This entire pipeline runs once, offline, per book. It does not run again during normal app usage.

## 7. Data Model (Graph Database)

### Node / relationship shape

```
Book
 └──HAS_CHAPTER──▶ Chapter (ordered)
                      └──OFFERS_PERSONA──▶ Persona (start state vector, gating rules)
                      └──HAS_DECISION──▶ Decision
                                           └──HAS_OPTION──▶ Option
                                                              ├─ state_delta {}
                                                              ├─ outcome_text
                                                              └──LEADS_TO──▶ next Decision | Chapter-End
```

- **Book**: top-level container. Fully isolated subgraph — no edges cross books.
- **Chapter**: ordered within a book; holds teaching content + its decisions.
- **Persona**: starting state vector (e.g., `{debt: 12000, savings: 200, stress: 4}`) plus which options/paths are hidden or unlocked for that persona.
- **Decision**: a choice point within a chapter.
- **Option**: an edge from a decision — carries the delta applied to state and the pre-written outcome text.
- **Chapter-End node**: aggregates final state for the chapter + references to the sibling option outcome texts for **every decision on the path taken** (multi-section recap, one block per visited decision — see `clarification-decisions-addendum.md` decision #5).

Retrieving "what if I'd chosen differently" is a direct edge lookup — no traversal logic or inference needed at runtime.

### Why graph over relational

- The natural structure here **is** a graph (decisions branching to decisions), not tables — a graph DB avoids modeling branches as self-joins or adjacency-list hacks.
- Traversing "next decision" / "sibling option" / "chapter chain" is native graph query territory (e.g., Cypher-style pattern matching) rather than recursive SQL.
- Per-book isolation and per-chapter subgraphs map cleanly onto disconnected graph partitions.

### Candidate graph DB options (for evaluation, not a decision)

| Option | Notes |
|---|---|
| Neo4j | Most mature graph query ecosystem (Cypher), strong tooling, this-shaped-workload is its home turf |
| Amazon Neptune | Managed, good if the rest of the stack is AWS |
| ArangoDB | Multi-model (graph + document) if some data doesn't fit graph cleanly |
| Dgraph | GraphQL-native, worth a look if the client API layer is GraphQL |

## 8. Client-Side Consequence Engine

**No LLM, no heavy runtime computation.** The "feels intelligent" quality comes from state-driven text selection, not live generation.

On each decision:
1. User picks an option.
2. Client applies the option's **stored delta** to the running state vector.
3. Client (or a thin server layer) looks up which **pre-authored outcome bucket** the new state falls into (thresholds set at authoring time — e.g., debt-to-income ratio bands: stable / risky / critical).
4. A simple weighted score classifies the result into a band — this is the minimax-adjacent piece: an **evaluation function**, not a search tree. There is no adversary and no lookahead; it's arithmetic plus a lookup table.
5. Chapter-end recap walks the client's path log and pulls the sibling options' stored outcome text for **each visited decision** — no computation, just retrieval (multi-fork recap per `clarification-decisions-addendum.md` decision #5).

This keeps the runtime cheap, deterministic, and fully offline-capable if needed, while still feeling responsive to the specific combination of choices a user has made — because the state vector, not a fixed script, drives which text is shown.

## 9. User Experience Flow

```
Select Book → Select Persona (sets starting state + gating) 
   → Chapter 1: read/learn → hit Decision(s) → state updates live 
   → Chapter-End Recap: final state for this chapter + "what the other 
     option(s) would have done" 
   → Chapter 2 (starts from carried-over state) → ... → Book complete
```

- State is visible to the user throughout (not just at recap) so consequences don't feel hidden until the end.
- Persona selection happens once, at book start, and shapes the entire run.

## 10. Book Isolation & Multi-Book Model

- Each book is authored, reviewed, and stored independently.
- No shared personas, no shared state, no shared decision graphs across books.
- Adding a new book to the catalog is a pipeline run (§6), not a code change to the client.
- The client's simulation engine is generic — it doesn't know "finance" vs. any other subject; it just applies deltas and looks up buckets. Book-specific meaning lives entirely in the data.

## 11. Open Questions for Next Phase

These are things the spec above doesn't yet resolve and will need answers before build:

1. **Rights/licensing** — do you have or need author/publisher permission to ingest full book text and generate derivative simulation content from it?
2. **Human review workflow** — who reviews (subject-matter expert vs. generalist editor), what's the rejection/rework loop back to the LLM pipeline, and what's the review UI?
3. **Persona gating detail** — is gating binary (option shown/hidden) or does it also change delta magnitudes for the same option across personas?
4. **Depth of state vector per book** — is there a fixed schema across all books (debt, savings, stress, etc.) or does each book define its own tracked variables? This affects whether the client engine is truly generic or needs per-book config.
5. **Onboarding/monetization** — not yet covered: how a user picks among the 4–5 launch books, any paywall/unlock model, progress saving across sessions.
6. **Authoring pipeline ownership** — is chapter ingestion/generation a one-person tool you run, or does it need its own admin interface for a team?

## 12. Terminology

- **Persona** — a pre-defined starting state + gating profile a user selects at the start of a book.
- **State vector** — the set of numeric/categorical variables tracked for a persona (debt, savings, stress, etc.).
- **Delta** — the change an option applies to the state vector.
- **Decision** — a choice point in a chapter with 2–4 options.
- **Option** — one choice at a decision point; carries a delta and outcome text.
- **Local counterfactual** — the stored outcome text for sibling options not chosen, shown at chapter-end.
- **Chapter-end recap** — summary screen showing final state and counterfactuals for that chapter.
