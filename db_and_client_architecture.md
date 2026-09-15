# DB & Client Architecture — Handling Cross-Book Heterogeneity

Addendum to `interactive-book-simulation-spec.md`, going deep on §7 and §8. The core problem this document solves: a finance book tracks debt/savings/stress, a habit book might track energy/consistency/motivation, a relationships book might track trust/communication — different variable counts, names, thresholds, and persona shapes. If any of that is hardcoded into the DB schema or the client app, every new book becomes an engineering change instead of a content pipeline run. That breaks the "launch with 4–5 books, add more later" premise. Everything below is designed around one rule:

> **The graph structure is identical across every book. What varies lives entirely in data (config), never in code or schema shape.**

## 1. DB Schema

### Book
```
Book {
  id, title, author, version, status: draft | published
}
```

### BookConfig — the heterogeneity anchor (1:1 with Book)
```
BookConfig {
  state_variables: [
    { key: "debt",   label: "Debt",   type: "currency", range: [0, null], display: "number",
      introduced_in_chapter: 1, default_value: 0 },
    { key: "stress", label: "Stress", type: "scale",    range: [0, 10],   display: "bar",
      introduced_in_chapter: 3, default_value: 2 }
  ],
  evaluation_bands: [
    { key: "stable",   condition: "debt < 5000" },
    { key: "risky",    condition: "debt >= 5000 AND debt < 15000" },
    { key: "critical", condition: "debt >= 15000" }
  ]
}
```
This is the piece that makes heterogeneity solvable. Every book supplies its own variable list and its own evaluation bands. The client never assumes "debt" or "stress" exists — it iterates whatever `state_variables` this config declares. A book with 3 tracked variables and a book with 7 use the exact same node type.

**Variables are introduced incrementally, not all upfront.** `stress` in the example above doesn't exist until chapter 3. `introduced_in_chapter` + `default_value` mean: a persona created before chapter 3 simply doesn't carry a `stress` key yet; when the user reaches chapter 3, the client initializes `state.stress = default_value` at that point, then deltas from chapter 3 onward can touch it. `BookConfig` is a running document that grows as chapters are authored — it isn't fully known until the last chapter of the book has been processed.

### Persona
```
Persona {
  id, book_id, name, description,
  starting_state: { <dynamic keys, must match BookConfig.state_variables> },
  gating_rules: [ { option_id, condition } ]
}
```

### Chapter → Decision → Option
```
Chapter { id, book_id, order, title, content_ref }
Decision { id, chapter_id, order, prompt }
Option {
  id, decision_id, label,
  next: decision_id | "chapter_end",
  persona_effects: [
    { persona_id: "budget_conscious",
      delta: { debt: -500, stress: -1 },
      outcome_text: "Debt drops to {debt} but it stretches an already tight month." },
    { persona_id: "high_earner",
      delta: { debt: -500, stress: +1 },
      outcome_text: "Debt drops to {debt}; the payment barely registers, but it's now automatic and rigid." }
  ]
}
```
The same option — same label, same decision — produces a **different delta and a different outcome_text per persona**. This is a deliberate choice (not every book needs it, but the pipeline supports it): the same choice can mean something different depending on who's making it. `starting_state` and each `persona_effects[].delta` are open maps constrained only by that book's own `BookConfig` — not by the database schema. This is what lets book A track 3 variables and book B track 7 without touching a table definition or a node label.

At read time, the client picks the `persona_effects` entry matching whichever persona the user selected at book-start — a lookup, not a computation.

## 1b. Proof This Isn't Finance-Specific: Two Books, Same Schema

Every example above happened to reuse `debt`/`stress`, which makes the schema *look* finance-shaped. It isn't — here's a finance book and a habit-formation book, sharing the identical `BookConfig`/`Persona`/`Option` node types with zero schema changes between them:

**Finance book config:**
```
BookConfig {
  state_variables: [
    { key: "debt",   type: "currency", range: [0, null], display: "number" },
    { key: "stress", type: "scale",    range: [0, 10],   display: "bar" }
  ],
  evaluation_bands: [
    { key: "stable",   condition: "debt < 5000" },
    { key: "critical", condition: "debt >= 15000" }
  ]
}
```

**Habit-formation book config — different domain, same node type, zero new fields:**
```
BookConfig {
  state_variables: [
    { key: "consistency", type: "scale",   range: [0, 100], display: "bar" },
    { key: "energy",      type: "scale",   range: [0, 10],  display: "number" },
    { key: "motivation",  type: "percent", range: [0, 100], display: "bar" }
  ],
  evaluation_bands: [
    { key: "on_track",  condition: "consistency >= 60" },
    { key: "slipping",  condition: "consistency < 30" }
  ]
}
```

Same story downstream: a habit-book `Option.persona_effects` entry might carry `{ consistency: +5, motivation: -10 }` instead of `{ debt: -500 }`, with `outcome_text` like `"Consistency is now {consistency}, motivation dropped to {motivation}."` — same template mechanism, different keys, still one entry per persona. The `Option`, `Persona`, and `Decision` node *definitions* don't change one bit between these two books; only the values inside them do.

If a relationships book, a productivity book, or anything else joins the catalog, it follows the same pattern — its own `state_variables` list, its own bands, no schema migration, no client code change.

## 2. DB Write Workflow (pipeline → DB)

1. **BookConfig seeded, not finalized, before chapter 1.** It may start with zero or a handful of variables — enough for the earliest personas and decisions. It's a running document, not a locked-in schema.
2. **Personas generated against the config as it exists at that point** — a persona's `starting_state` only needs keys for variables that exist when the persona is created; later-introduced variables aren't required.
3. **Chapters → Decisions → Options generated in order.** Each chapter's processing pass may **extend BookConfig** with new variables it needs (tagged `introduced_in_chapter` + a `default_value`), and every `persona_effects[].delta` is validated against whatever the config contains *as of that chapter* — not the whole book's eventual final config, which doesn't exist yet.
4. Everything writes with `status: draft`.
5. **Human review gate** flips reviewed nodes to `status: published`. The client only ever queries published nodes — draft content is invisible to users by construction, not by convention.
6. **Re-authoring a chapter later** creates a new version rather than overwriting in place, so a user mid-book isn't silently moved onto a changed graph mid-session. (Full versioning strategy is an open item below — this just states the direction.)

## 3. DB Read Workflow (client → DB, by moment in the journey)

Superseded by `clarification-decisions-addendum.md` decision #1 and `db-performance-plan.md`: the client downloads the **full bundle once per book per version** (`GET /books/{id}/bundle` → CDN redirect) and plays offline. No chapter-by-chapter fetch exists. The table below is kept for history only.

| Moment | What's fetched (outdated — see bundle plan) |
|---|---|
| Book selection screen | All `Book` nodes where `status: published` |
| Book opened | That book's `BookConfig` + all its `Persona` nodes |
| Persona selected | `starting_state` copied into the client's local running state |
| Chapter starts | That `Chapter`'s full subgraph: `Decision` + `Option` nodes. Client checks `BookConfig` for any variable with `introduced_in_chapter` matching this chapter and seeds it into `state` via `default_value` if not already present |
| Option chosen | No new query — delta/outcome text already loaded with the chapter |
| Chapter ends | Sibling `Option.outcome_text` values — already in the chapter payload from the previous fetch |

Practical implication: fetch **config once per book** and **a full chapter's subgraph once per chapter**, not per-decision. This avoids round-tripping to the DB on every tap and lets a chapter run offline once it's loaded.

## 4. Client-Side Architecture (config-driven, not book-specific)

The client holds two things in memory:
- `bookConfig` — fetched once per book; defines what variables exist and how to display/evaluate them
- `state` — an object whose keys are exactly whatever `bookConfig.state_variables` lists, seeded from the chosen persona's `starting_state`

Four generic engine functions — same code for every book, regardless of what it tracks:

```
initVariableIfNeeded(state, variable, bookConfig)        // on entering variable.introduced_in_chapter, seeds state[key] = default_value if absent
getEffectForPersona(option, personaId)                   // picks the matching persona_effects entry for the current persona
applyDelta(state, effect.delta)                          // merges that persona's delta into current state
evaluateBand(state, bookConfig.evaluation_bands)         // returns which band ("stable"/"risky"/etc.) state falls into
renderVariable(key, value, bookConfig)                   // uses each variable's `display` type to draw a bar, currency, raw number...
resolveOutcomeText(effect.outcome_text, state)           // fills {debt}, {stress}, etc. placeholders from live state
```

None of these functions contain the word "debt" or "stress," and none contain a specific persona name. They iterate config and look up by whichever persona_id the user is currently playing. This is what lets a single client codebase run five structurally different books — with persona-dependent consequences and variables that appear mid-book — without a code change per book.

## 5. What's Fixed vs. What Varies

| Fixed (schema & code) | Varies (data & config) |
|---|---|
| Node types: Book, Chapter, Persona, Decision, Option | Number and names of state variables |
| Graph shape: ordered chapters, branching decisions | Number of personas and their starting values |
| Client engine logic (apply delta, evaluate band, render, resolve text) | Evaluation band thresholds/conditions |
| Read/write workflow and review gate | Gating rules, delta magnitudes, outcome text content |

## 6. Open Items This Split Surfaces

1. **Versioning** — resolved: always-latest, no pinning (see `db-performance-plan.md` §2.2 and `api-service-layer.md` §7.3). Re-fetch migrates forward; rollback is a pointer swap. The old pinning direction in §2.6 is superseded.
2. **Offline/caching strategy** — resolved: full bundle cached on first open (config + all published chapters), offline play after (see `db-performance-plan.md` §2.2–2.4).
3. **Validation ownership** — pipeline-time check (recommended) or a runtime check that a persona's `starting_state` and every option's `delta` only reference keys declared in that book's `BookConfig`?
4. **Outcome-text templating depth** — is placeholder-fill (`{debt}`) sufficient, or does authoring need conditional phrasing within a single outcome string (e.g., different wording if a variable went up vs. down)?
