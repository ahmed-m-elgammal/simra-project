# Plan 01 — Builder Core (deterministic, no network, no LLM)

> For agentic workers: implement task-by-task in order. Steps use checkbox (`- [ ]`) syntax. Do not skip tests; do not commit red.

**Goal:** A tested TypeScript package that validates canonical book JSON and compiles it to a byte-identical serving bundle.

**Architecture:** Pure functions only (`compile(canonical) → bundle`). Zod schemas at the boundary. Vitest goldens prove byte-identical output; fuzz proves no panics. No network, no LLM keys, no Supabase in this plan (Edge wrapper is Plan 03).

**Tech Stack:** TypeScript strict, `zod`, `vitest`, `simple-statistics` (quantiles only), Node `zlib`/`crypto` builtins. Embeddings behind a provider interface with a fake for tests (real `@huggingface/transformers` provider is implemented but exercised manually, never in CI — the 120MB model does not download in test runs).

**Repo layout this plan creates:**

```
builder/src/index.ts            # public API: compile(), validate()
builder/src/schemas.ts          # Zod: canonical + bundle schemas
builder/src/ledger.ts           # variable ledger check
builder/src/dag.ts              # cycle / reachability / termination
builder/src/gating.ts           # requires validation + always-available rule
builder/src/normalize.ts        # byId maps + effectsByPersona pivot
builder/src/precompile.ts       # predicates + bands → lambda strings
builder/src/minify.ts           # key map v1 + serialize + hash + compress
builder/src/auditor.ts          # meaningfulness + balance + coverage + readability
builder/src/duplicates.ts       # embeddings interface + union-find flags
builder/src/bands.ts            # quantile/k-means proposal + Monte Carlo
builder/src/embeddings/fake.ts  # deterministic test provider
builder/src/embeddings/transformers.ts  # real provider, lazy, manual-test only
builder/fixtures/habits-ch1.canonical.json
builder/fixtures/habits-ch1.bundle.hash   # sha256 of expected output
builder/fixtures/invalid-*.json
builder/fixtures/duplicates.fixtures.json # 20+ variable pairs + expected flag/merge/keep
package.json  tsconfig.json  vitest.config.ts  (repo root + package)
```

Key map v1 (locked, from `bundle-builder.md`): `d=delta, o=outcome_text, r=requires, l=lock_reason, e=effectsByPersona, v=state_variables`. Predicate grammar: `{all:[], any:[], not:{}}` of `{var, op, value}`, ops `==,!=,<,<=,>,>=`.

---

### Task 1: Scaffold repo + package

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `vitest.config.ts`, `builder/package.json`, `builder/src/index.ts`

Root `package.json` must include `"type": "module"`, root devDependencies `vitest + typescript`, and test script `vitest run --passWithNoTests` (zero-test runs exit 0).

- [ ] **Step 1: Write root package.json (pnpm workspaces)**

```json
{
  "name": "bookforge",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "workspaces": ["builder", "cli", "mobile"],
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" }
}
```

- [ ] **Step 2: Write `builder/package.json`**

```json
{
  "name": "@app/bundle-builder",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": { "zod": "^3.23.0", "simple-statistics": "^7.8.0" }
}
```

- [ ] **Step 3: Write minimal `src/index.ts`**

```ts
export function version(): string {
  return "0.1.0";
}
```

- [ ] **Step 4: Install + run tests (expect zero tests, pass)**

Run: `pnpm install && pnpm test`
Expected: PASS, no test files found.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml builder/package.json builder/src/index.ts tsconfig.json vitest.config.ts
git commit -m "chore: scaffold bookforge monorepo + builder package"
```

---

### Task 2: Canonical Zod schemas

**Files:**
- Create: `builder/src/schemas.ts`
- Test: `builder/src/schemas.test.ts`
- Create: `builder/fixtures/habits-ch1.canonical.json`, `builder/fixtures/invalid-missing-persona.json`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CanonicalChapterSchema } from "./schemas.js";

const good = JSON.parse(readFileSync("fixtures/habits-ch1.canonical.json", "utf8"));
const bad = JSON.parse(readFileSync("fixtures/invalid-missing-persona.json", "utf8"));

describe("schemas", () => {
  it("accepts a valid chapter", () => {
    expect(CanonicalChapterSchema.safeParse(good).success).toBe(true);
  });
  it("rejects an option missing a persona effect", () => {
    const r = CanonicalChapterSchema.safeParse(bad);
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/schemas.test.ts`
Expected: FAIL with "Cannot find module './schemas.js'".

Tests load fixtures via `fileURLToPath(import.meta.url)` (cwd-safe under both root and package runs). `invalid-missing-persona.json` uses an empty `persona_effects` array (schema-shape violation); per-persona coverage is enforced by Task 3's `MISSING_PERSONA` validator, not the schema.

- [ ] **Step 4: Write minimal schemas**

```ts
import { z } from "zod";

export const RequiresSchema: z.ZodTypeUnknown = z.lazy(() =>
  z.union([
    z.null(),
    z.object({
      all: z.array(z.object({ var: z.string(), op: z.enum(["==", "!=", "<", "<=", ">", ">="]), value: z.number() })),
    }),
    z.object({
      any: z.array(z.object({ var: z.string(), op: z.enum(["==", "!=", "<", "<=", ">", ">="]), value: z.number() })),
    }),
    z.object({ not: RequiresSchema }),
  ]),
) as z.ZodType<unknown>;

export const PersonaEffectSchema = z.object({
  persona_id: z.string().min(1),
  delta: z.record(z.string(), z.number()),
  outcome_text: z.string().min(20).max(2000),
});

export const OptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  intent: z.string().min(1),
  next: z.string().min(1),
  requires: RequiresSchema,
  lock_reason: z.string().min(1),
  persona_effects: PersonaEffectSchema.array().min(1),
});

export const DecisionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  options: OptionSchema.array().min(2).max(4),
});

export const CanonicalChapterSchema = z.object({
  chapter_id: z.string().min(1),
  order: z.number().int().nonnegative(),
  sourcing: z.object({ mode: z.enum(["extract", "invent"]), quote: z.string() }),
  new_variables: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      type: z.string().min(1),
      range: z.tuple([z.number().nullable(), z.number().nullable()]),
      display: z.enum(["bar", "number", "currency", "percent"]),
      default_value: z.number(),
      distinction_note: z.string().optional(),
    }),
  ),
  decisions: DecisionSchema.array().min(1),
  recap_hints: z.array(z.object({ persona_id: z.string(), hint: z.string() })),
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/schemas.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add builder/src/schemas.ts builder/src/schemas.test.ts builder/fixtures/habits-ch1.canonical.json builder/fixtures/invalid-missing-persona.json
git commit -m "feat(builder): canonical Zod schemas + fixtures"
```

---

### Task 3: Ledger + DAG + gating validators

**Files:**
- Create: `builder/src/ledger.ts`, `builder/src/dag.ts`, `builder/src/gating.ts`
- Test: `builder/src/validate.test.ts`
- Create: `builder/fixtures/invalid-cycle.json`, `builder/fixtures/invalid-unknown-var.json`, `builder/fixtures/invalid-all-locked.json`, `builder/fixtures/invalid-word-count.json` (one `outcome_text` of 1 word, e.g. "Hi.")

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateChapter } from "./index.js";

const load = (n: string) => JSON.parse(readFileSync(`fixtures/${n}`, "utf8"));
const ledger = { consistency: { introduced_in: 1 }, energy: { introduced_in: 1 } };

describe("validateChapter", () => {
  it("accepts the good fixture", () => {
    expect(validateChapter(load("habits-ch1.canonical.json"), ["maya", "omar"], ledger)).toEqual([]);
  });
  it("flags a next-graph cycle with node ids", () => {
    const errs = validateChapter(load("invalid-cycle.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "DAG_CYCLE")).toBe(true);
  });
  it("flags delta keys outside the ledger", () => {
    const errs = validateChapter(load("invalid-unknown-var.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "UNKNOWN_VAR")).toBe(true);
  });
  it("flags a decision with no always-available option", () => {
    const errs = validateChapter(load("invalid-all-locked.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "NO_OPEN_OPTION")).toBe(true);
  });
  it("flags outcome_text outside 30-100 words (spec: 40-70, validator tolerates 30-100)", () => {
    const errs = validateChapter(load("invalid-word-count.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "WORD_COUNT")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/validate.test.ts`
Expected: FAIL with "validateChapter is not a function".

Tests load fixtures via `fileURLToPath(import.meta.url)` (cwd-safe). All invalid fixtures use valid-length outcome prose so each isolates exactly one failure code. Implementation additionally checks `requires` vars against the ledger (same `UNKNOWN_VAR` code) — cheap, same rule family.

Review fixes (applied after Tasks 1-7 evidence pass, commit `f349b5a`): minify is structural key-rename (string-replace would corrupt `"key":`-shaped prose inside outcome text); new blocking `DUPLICATE_ID` gate (dup decision/option ids silently overwrote maps; dup persona effects in one option); crash hardening (`?? []`, non-string `outcome_text` coerced — library never throws on malformed input); `all`/`any` arrays require `.min(1)` (empty `{all:[]}` compiled open but failed the null-check — now rejected at schema with a clear error).

- [ ] **Step 4: Write minimal validators**

```ts
export interface ValidationError {
  code: "DAG_CYCLE" | "DAG_ORPHAN" | "DAG_DEAD_END" | "UNKNOWN_VAR" | "MISSING_PERSONA" | "NO_OPEN_OPTION" | "BAD_PLACEHOLDER" | "WORD_COUNT";
  message: string;
  nodeIds: string[];
}

interface Ledger {
  [key: string]: { introduced_in: number };
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

export function validateChapter(chapter: any, personaIds: string[], ledger: Ledger): ValidationError[] {
  const errs: ValidationError[] = [];
  const ids = new Set<string>();
  for (const d of chapter.decisions) {
    ids.add(d.id);
    for (const o of d.options) ids.add(o.id);
  }
  // DAG: cycle via iterative DFS over next edges (chapter_end = terminal)
  const adj = new Map<string, string[]>();
  for (const d of chapter.decisions) {
    adj.set(
      d.id,
      d.options.map((o: any) => o.next).filter((n: string) => n !== "chapter_end"),
    );
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (start: string): void => {
    const work: Array<[string, number]> = [[start, 0]];
    while (work.length > 0) {
      const [node, idx] = work[work.length - 1];
      if ((color.get(node) ?? WHITE) === WHITE) {
        color.set(node, GRAY);
        stack.push(node);
      }
      const nexts = adj.get(node) ?? [];
      if (idx < nexts.length) {
        work[work.length - 1][1] += 1;
        const m = nexts[idx];
        if (!ids.has(m)) {
          errs.push({ code: "DAG_DEAD_END", message: `next target missing: ${m}`, nodeIds: [node] });
          continue;
        }
        const c = color.get(m) ?? WHITE;
        if (c === GRAY) {
          const cyc = [...stack.slice(stack.indexOf(m)), m];
          errs.push({ code: "DAG_CYCLE", message: `cycle: ${cyc.join(" -> ")}`, nodeIds: cyc });
        } else if (c === WHITE) {
          work.push([m, 0]);
        }
      } else {
        color.set(node, BLACK);
        stack.pop();
        work.pop();
      }
    }
  };
  for (const d of chapter.decisions) {
    if ((color.get(d.id) ?? WHITE) === WHITE) visit(d.id);
  }
  // Reachability from first decision
  const seen = new Set<string>();
  const queue = [chapter.decisions[0]?.id].filter(Boolean) as string[];
  while (queue.length > 0) {
    const n = queue.pop() as string;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) queue.push(m);
  }
  for (const d of chapter.decisions) {
    if (!seen.has(d.id)) errs.push({ code: "DAG_ORPHAN", message: `unreachable decision: ${d.id}`, nodeIds: [d.id] });
  }
  // Termination: every decision reaches chapter_end
  const reachesEnd = (start: string): boolean => {
    const s = new Set<string>([start]);
    const q = [start];
    while (q.length > 0) {
      const n = q.pop() as string;
      const d = chapter.decisions.find((x: any) => x.id === n);
      for (const o of d?.options ?? []) {
        if (o.next === "chapter_end") return true;
        if (!s.has(o.next)) {
          s.add(o.next);
          q.push(o.next);
        }
      }
    }
    return false;
  };
  for (const d of chapter.decisions) {
    if (!reachesEnd(d.id)) errs.push({ code: "DAG_DEAD_END", message: `no path to chapter_end from ${d.id}`, nodeIds: [d.id] });
  }
  // Per-option checks
  for (const d of chapter.decisions) {
    if (!d.options.some((o: any) => o.requires === null)) {
      errs.push({ code: "NO_OPEN_OPTION", message: `decision has no always-available option: ${d.id}`, nodeIds: [d.id] });
    }
    for (const o of d.options) {
      const have = new Set(o.persona_effects.map((e: any) => e.persona_id));
      for (const p of personaIds) {
        if (!have.has(p)) errs.push({ code: "MISSING_PERSONA", message: `option ${o.id} missing persona ${p}`, nodeIds: [o.id] });
      }
      for (const e of o.persona_effects) {
        for (const k of Object.keys(e.delta ?? {})) {
          if (!(k in ledger)) errs.push({ code: "UNKNOWN_VAR", message: `delta key not in ledger: ${k}`, nodeIds: [o.id] });
        }
        for (const m of e.outcome_text.matchAll(PLACEHOLDER)) {
          if (!(m[1] in ledger)) errs.push({ code: "BAD_PLACEHOLDER", message: `placeholder not in ledger: {${m[1]}}`, nodeIds: [o.id] });
        }
      }
    }
  }
  return errs;
}
```

Split into `ledger.ts` (key-existence helper), `dag.ts` (cycle/reachability/termination), `gating.ts` (always-available rule) in the real files; `index.ts` re-exports `validateChapter` composing them. Keep the exact error codes above — tests and the CLI depend on them. Word-count rule (blocking): every `outcome_text` must hold 30–100 whitespace-separated words (`text.trim().split(/\s+/).length`); emit `WORD_COUNT` with the option id. Bounds are wider than the spec's 40–70 so valid prose never fails brittlely.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/validate.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add builder/src/ledger.ts builder/src/dag.ts builder/src/gating.ts builder/src/validate.test.ts builder/fixtures/invalid-cycle.json builder/fixtures/invalid-unknown-var.json builder/fixtures/invalid-all-locked.json builder/src/index.ts
git commit -m "feat(builder): ledger + DAG + gating validators"
```

---

### Task 4: Normalize + pivot

**Files:**
- Create: `builder/src/normalize.ts`
- Test: `builder/src/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeChapter } from "./normalize.js";

describe("normalizeChapter", () => {
  it("pivots effects arrays to byPersona maps and preserves order", () => {
    const ch = JSON.parse(readFileSync("fixtures/habits-ch1.canonical.json", "utf8"));
    const n = normalizeChapter(ch);
    expect(n.decisionIds).toEqual(ch.decisions.map((d: any) => d.id));
    const oid = ch.decisions[0].options[0].id;
    expect(Object.keys(n.optionsById[oid].effectsByPersona).sort()).toEqual(["maya", "omar"]);
    expect(n.optionsById[oid].effectsByPersona.maya.delta).toEqual(
      ch.decisions[0].options[0].persona_effects.find((e: any) => e.persona_id === "maya").delta,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/normalize.test.ts`
Expected: FAIL with "Cannot find module './normalize.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
export interface NormalizedChapter {
  chapter_id: string;
  decisionIds: string[];
  decisionsById: Record<string, { prompt: string; optionIds: string[] }>;
  optionsById: Record<string, { label: string; intent: string; next: string; requires: unknown; lock_reason: string; effectsByPersona: Record<string, { delta: Record<string, number>; outcome_text: string }> }>;
}

export function normalizeChapter(ch: any): NormalizedChapter {
  const decisionsById: NormalizedChapter["decisionsById"] = {};
  const optionsById: NormalizedChapter["optionsById"] = {};
  const decisionIds: string[] = [];
  for (const d of ch.decisions) {
    decisionIds.push(d.id);
    decisionsById[d.id] = { prompt: d.prompt, optionIds: d.options.map((o: any) => o.id) };
    for (const o of d.options) {
      const effectsByPersona: Record<string, { delta: Record<string, number>; outcome_text: string }> = {};
      for (const e of o.persona_effects) {
        effectsByPersona[e.persona_id] = { delta: e.delta, outcome_text: e.outcome_text };
      }
      optionsById[o.id] = { label: o.label, intent: o.intent, next: o.next, requires: o.requires, lock_reason: o.lock_reason, effectsByPersona };
    }
  }
  return { chapter_id: ch.chapter_id, decisionIds, decisionsById, optionsById };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/normalize.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
git add builder/src/normalize.ts builder/src/normalize.test.ts
git commit -m "feat(builder): normalize to byId maps + effectsByPersona pivot"
```

---

### Task 5: Predicate + band precompiler (AST whitelist, no eval)

**Files:**
- Create: `builder/src/precompile.ts`
- Test: `builder/src/precompile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compileRequires, compileBand } from "./precompile.js";

const run = (fn: string, s: Record<string, number>): unknown => new Function("s", `return (${fn})(s);`)(s);

describe("precompile", () => {
  it("compiles an all-predicate", () => {
    const fn = compileRequires({ all: [{ var: "energy", op: ">=", value: 4 }] });
    expect(run(fn, { energy: 5 })).toBe(true);
    expect(run(fn, { energy: 2 })).toBe(false);
  });
  it("compiles any/not nesting", () => {
    const fn = compileRequires({ any: [{ var: "a", op: "==", value: 1 }, { not: { all: [{ var: "b", op: "<", value: 0 }] } }] });
    expect(run(fn, { a: 0, b: 5 })).toBe(true);
  });
  it("rejects unknown ops and bad var names", () => {
    expect(() => compileRequires({ all: [{ var: "energy", op: "~=", value: 1 }] })).toThrow();
    expect(() => compileRequires({ all: [{ var: "drop table", op: "==", value: 1 }] })).toThrow();
  });
  it("compiles a band predicate identically", () => {
    const fn = compileBand({ all: [{ var: "consistency", op: ">=", value: 60 }] });
    expect(run(fn, { consistency: 70 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/precompile.test.ts`
Expected: FAIL with "Cannot find module './precompile.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
const OPS = new Set(["==", "!=", "<", "<=", ">", ">="]);
const VAR = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type Atom = { var: string; op: string; value: number };
type Node = { all: Node[] } | { any: Node[] } | { not: Node } | Atom;

function isAtom(n: Node): n is Atom {
  return typeof (n as Atom).var === "string";
}

function compileNode(n: Node, knownVars: Set<string> | null): string {
  if (isAtom(n)) {
    if (!OPS.has(n.op)) throw new Error(`unknown op: ${n.op}`);
    if (!VAR.test(n.var)) throw new Error(`bad var name: ${n.var}`);
    if (knownVars && !knownVars.has(n.var)) throw new Error(`unknown var: ${n.var}`);
    if (typeof n.value !== "number" || Number.isNaN(n.value)) throw new Error(`bad value for ${n.var}`);
    const access = `((s[${JSON.stringify(n.var)}]) ?? 0)`;
    return n.op === "==" ? `(${access} === ${n.value})` : n.op === "!=" ? `(${access} !== ${n.value})` : `(${access} ${n.op} ${n.value})`;
  }
  if ("all" in n) return `(${(n.all as Node[]).map((c) => compileNode(c, knownVars)).join(" && ") || "true"})`;
  if ("any" in n) return `(${(n.any as Node[]).map((c) => compileNode(c, knownVars)).join(" || ") || "false"})`;
  return `(!${compileNode((n as { not: Node }).not, knownVars)})`;
}

export function compileRequires(requires: unknown, knownVars?: string[]): string {
  if (requires === null) return "true";
  return `s => ${compileNode(requires as Node, knownVars ? new Set(knownVars) : null)}`;
}

export function compileBand(predicate: unknown, knownVars?: string[]): string {
  return compileRequires(predicate, knownVars);
}
```

Note: `new Function` appears in tests only, never in shipped code. Shipped code outputs strings; the client evaluates them as arrow functions.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/precompile.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add builder/src/precompile.ts builder/src/precompile.test.ts
git commit -m "feat(builder): safe predicate precompiler (whitelist, no eval)"
```

---

### Task 6: Minify + serialize + hash + compress, then `compile()` + goldens

**Files:**
- Create: `builder/src/minify.ts`
- Test: `builder/src/compile.test.ts`
- Create: `builder/fixtures/habits-ch1.bundle.hash` (filled in Step 4)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { compile } from "./index.js";

describe("compile", () => {
  it("is byte-identical to the golden hash", () => {
    const ch = JSON.parse(readFileSync("fixtures/habits-ch1.canonical.json", "utf8"));
    const book = {
      book_id: "habits",
      version: 1,
      config: { vars: [{ key: "consistency" }, { key: "energy" }], bands: [] },
      personas: [{ persona_id: "maya" }, { persona_id: "omar" }],
      chapters: [ch],
    };
    const out = compile(book);
    const hash = createHash("sha256").update(out.json).digest("hex");
    const golden = readFileSync("fixtures/habits-ch1.bundle.hash", "utf8").trim();
    expect(hash).toBe(golden);
    expect(out.json.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/compile.test.ts`
Expected: FAIL with "compile is not a function".

- [ ] **Step 3: Write minimal `minify.ts` + `compile()` in `index.ts`**

```ts
// minify.ts
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";

export const KEYMAP = { delta: "d", outcome_text: "o", requires: "r", lock_reason: "l", effectsByPersona: "e", state_variables: "v" } as const;

export function minifyBundle(bundle: unknown): { json: string; br: Buffer; gz: Buffer; sha: string } {
  const raw = JSON.stringify(bundle);
  let json = raw;
  for (const [long, short] of Object.entries(KEYMAP)) {
    json = json.split(`"${long}":`).join(`"${short}":`);
  }
  return {
    json,
    br: brotliCompressSync(Buffer.from(json)),
    gz: gzipSync(Buffer.from(json)),
    sha: createHash("sha256").update(json).digest("hex"),
  };
}
```

```ts
// index.ts (append; keep version() and validateChapter)
import { normalizeChapter } from "./normalize.js";
import { compileRequires, compileBand } from "./precompile.js";
import { minifyBundle } from "./minify.js";

export function compile(book: any): { json: string; br: Buffer; gz: Buffer; sha: string } {
  const chaptersById: Record<string, unknown> = {};
  for (const ch of book.chapters) {
    const n = normalizeChapter(ch);
    const optionsById: Record<string, unknown> = {};
    for (const [oid, o] of Object.entries(n.optionsById) as Array<[string, any]>) {
      optionsById[oid] = { ...o, requires_compiled: compileRequires(o.requires) };
    }
    chaptersById[ch.chapter_id] = { ...n, optionsById };
  }
  const bundle = {
    format: 1,
    book_id: book.book_id,
    version: book.version,
    config: { ...book.config, bands_compiled: (book.config.bands ?? []).map((b: any) => ({ key: b.key, fn: compileBand(b.predicate) })) },
    personasById: Object.fromEntries(book.personas.map((p: any) => [p.persona_id, p])),
    chaptersById,
  };
  return minifyBundle(bundle);
}
```

Bundle shape intentionally mirrors `bundle-builder.md` §3 (format, version, personasById, chaptersById, compiled fns).

- [ ] **Step 4: Generate the golden hash (one time, then frozen)**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/compile.test.ts`
Expected: FAIL showing received hash. Copy the received sha into `fixtures/habits-ch1.bundle.hash` (single hex line). Re-run.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builder/src/minify.ts builder/src/compile.test.ts builder/src/index.ts builder/fixtures/habits-ch1.bundle.hash
git commit -m "feat(builder): compile() + golden byte-identical fixture"
```

---

### Task 7: Duplicates screen (provider interface + fake; real provider manual-only)

**Files:**
- Create: `builder/src/duplicates.ts`, `builder/src/embeddings/types.ts`, `builder/src/embeddings/fake.ts`, `builder/src/embeddings/transformers.ts`
- Test: `builder/src/duplicates.test.ts`
- Create: `builder/fixtures/duplicates.fixtures.json` (8 pairs minimum to start: stress/anxiety_level → flag, consistency/habit_streak → keep, debt/what_you_owe → merge, plus 5 more)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { screenDuplicates } from "./duplicates.js";
import { FakeEmbeddings } from "./embeddings/fake.js";

describe("screenDuplicates", () => {
  it("flags/merges/keeps per fixtures", () => {
    const fx = JSON.parse(readFileSync("fixtures/duplicates.fixtures.json", "utf8"));
    const out = screenDuplicates(
      fx.vars,
      new FakeEmbeddings(fx.similarity),
      { flag: 0.85, note: 0.7 },
    );
    for (const e of fx.expected) {
      const got = out.find((r) => r.a === e.a && r.b === e.b);
      expect(got?.verdict).toBe(e.verdict);
    }
  });
});
```

`FakeEmbeddings` exposes a public `getSim(a, b)` lookup (bidirectional) instead of reaching into internals; the sync `screenDuplicates` uses it. Fixture similarity keys use `\u0000` separators (JSON has no `\0` escape). `@huggingface/transformers` is a real installed dependency for types + manual runs — just never imported by unit tests, so CI downloads no model.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/duplicates.test.ts`
Expected: FAIL with "Cannot find module './duplicates.js'".

- [ ] **Step 3: Write fixtures + implementation**

```ts
// embeddings/types.ts
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // providers must return normalized vectors
}
```

```ts
// embeddings/fake.ts
import type { EmbeddingProvider } from "./types.js";

export class FakeEmbeddings implements EmbeddingProvider {
  constructor(private sim: Record<string, number>) {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t, i) => {
      if (i === 0) return new Float32Array([1, 0]);
      const s = this.sim[`${texts[0]}\0${t}`] ?? 0;
      return new Float32Array([s, Math.sqrt(Math.max(0, 1 - s * s))]);
    });
  }
}
```

```ts
// duplicates.ts
import { cosine, type EmbeddingProvider } from "./embeddings/types.js";

export interface DuplicateFinding {
  a: string;
  b: string;
  score: number;
  verdict: "merge" | "flag" | "note" | "keep";
}

export async function screenDuplicatesAsync(
  vars: Array<{ key: string; gloss: string }>,
  provider: EmbeddingProvider,
  thresholds = { flag: 0.85, note: 0.7 },
): Promise<DuplicateFinding[]> {
  const vecs = await provider.embed(vars.map((v) => v.gloss));
  const out: DuplicateFinding[] = [];
  for (let i = 0; i < vars.length; i++) {
    for (let j = i + 1; j < vars.length; j++) {
      const score = cosine(vecs[i], vecs[j]);
      out.push({
        a: vars[i].key,
        b: vars[j].key,
        score,
        verdict: score > thresholds.flag ? "flag" : score > thresholds.note ? "note" : "keep",
      });
    }
  }
  return out;
}

// Synchronous variant used by tests via FakeEmbeddings batching trick above.
export function screenDuplicates(
  vars: Array<{ key: string; gloss: string }>,
  provider: FakeEmbeddings,
  thresholds = { flag: 0.85, note: 0.7 },
): DuplicateFinding[] {
  const out: DuplicateFinding[] = [];
  for (let i = 0; i < vars.length; i++) {
    for (let j = i + 1; j < vars.length; j++) {
      const key = `${vars[i].gloss}\0${vars[j].gloss}`;
      const score = (provider as any).sim[key] ?? 0;
      void cosine;
      out.push({
        a: vars[i].key,
        b: vars[j].key,
        score,
        verdict: score > thresholds.flag ? "flag" : score > thresholds.note ? "note" : "keep",
      });
    }
  }
  return out;
}
```

Keep both variants: async for production, sync for deterministic unit tests. `merge` verdicts come from reviewer action, never auto (spec rule) — fixtures use `flag` for merge-candidates.

```ts
// embeddings/transformers.ts (manual-test only, never imported by tests)
import type { EmbeddingProvider } from "./types.js";

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

export class TransformersEmbeddings implements EmbeddingProvider {
  private pipe: any = null;
  async embed(texts: string[]): Promise<Float32Array[]> {
    const { pipeline } = await import("@huggingface/transformers");
    this.pipe ??= await pipeline("feature-extraction", MODEL);
    const out = await this.pipe(texts, { pooling: "mean", normalize: true });
    return out.tolist().map((v: number[]) => new Float32Array(v));
  }
}
```

Production wiring pins the multilingual model per `prepare-algorithms.md` §3; the lab procedure in §3b picks challengers.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/duplicates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add builder/src/duplicates.ts builder/src/duplicates.test.ts builder/src/embeddings/ builder/fixtures/duplicates.fixtures.json
git commit -m "feat(builder): duplicate screen + embeddings providers"
```

---

### Task 8: Band proposal + Monte Carlo + auditor

**Files:**
- Create: `builder/src/bands.ts`, `builder/src/auditor.ts`
- Test: `builder/src/bands.test.ts`, `builder/src/auditor.test.ts`

- [ ] **Step 1: Write the failing bands test (deterministic seed)**

```ts
import { describe, expect, it } from "vitest";
import { proposeBands, monteCarlo } from "./bands.js";

describe("bands", () => {
  it("proposes 2 cuts inside the observed range", () => {
    const deltas = [2, 3, 3, 4, 5, 6, 8, 9, 12];
    const cuts = proposeBands(deltas, 3);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toBeGreaterThanOrEqual(Math.min(...deltas));
    expect(cuts[1]).toBeLessThanOrEqual(Math.max(...deltas));
    expect(cuts[0]).toBeLessThan(cuts[1]);
  });
  it("monte carlo is deterministic for the same seed", () => {
    const g = { start: { x: 0 }, steps: [{ options: [{ delta: { x: 1 } }, { delta: { x: -1 } }] }] };
    const a = monteCarlo(g, 1000, 42);
    const b = monteCarlo(g, 1000, 42);
    expect(a).toEqual(b);
    expect(a.mean.x).toBeCloseTo(0, 0);
  });
});
```

`proposeBands(values, k)`: quantiles at `i/k` via `simple-statistics` `quantileSorted` on sorted values, k≤3, deterministic. `monteCarlo(graph, walks, seed)`: mulberry32 PRNG (implement inline, 10 lines), uniform option sampling per step, returns `{mean, min, max}` per var.

- [ ] **Step 2: Write the failing auditor test**

```ts
import { describe, expect, it } from "vitest";
import { auditDecision } from "./auditor.js";

const D = (...deltas: Array<Record<string, number>>) => ({
  options: deltas.map((delta, i) => ({ id: `o${i}`, persona_effects: [{ persona_id: "p", delta }] })),
});

describe("auditor", () => {
  it("flags a meaningless choice (identical deltas)", () => {
    expect(auditDecision(D({ x: 1 }, { x: 1 }), ["p"]).some((e) => e.code === "MEANINGLESS")).toBe(true);
  });
  it("flags a dominating option (better on every var)", () => {
    expect(auditDecision(D({ x: 1, y: 1 }, { x: 5, y: 5 }), ["p"]).some((e) => e.code === "DOMINANT")).toBe(true);
  });
  it("passes a real tradeoff", () => {
    expect(auditDecision(D({ x: 5, y: -2 }, { x: -1, y: 4 }), ["p"])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/bands.test.ts src/auditor.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 4: Write minimal implementations**

```ts
// bands.ts
import { quantileSorted } from "simple-statistics";

export function proposeBands(values: number[], k: number): number[] {
  if (k > 3) throw new Error("k≤3 per spec");
  const sorted = [...values].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let i = 1; i < k; i++) cuts.push(quantileSorted(sorted, i / k));
  return cuts;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function monteCarlo(
  graph: { start: Record<string, number>; steps: Array<{ options: Array<{ delta: Record<string, number> }> }> },
  walks: number,
  seed: number,
): { mean: Record<string, number>; min: Record<string, number>; max: Record<string, number> } {
  const rand = mulberry32(seed);
  const sums: Record<string, number> = {};
  const mins: Record<string, number> = {};
  const maxs: Record<string, number> = {};
  for (let w = 0; w < walks; w++) {
    const state = { ...graph.start };
    for (const step of graph.steps) {
      const o = step.options[Math.floor(rand() * step.options.length)];
      for (const [k, v] of Object.entries(o.delta)) state[k] = (state[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(state)) {
      sums[k] = (sums[k] ?? 0) + v;
      mins[k] = Math.min(mins[k] ?? v, v);
      maxs[k] = Math.max(maxs[k] ?? v, v);
    }
  }
  const mean: Record<string, number> = {};
  for (const k of Object.keys(sums)) mean[k] = sums[k] / walks;
  return { mean, min: mins, max: maxs };
}
```

```ts
// auditor.ts
export interface AuditFinding {
  code: "MEANINGLESS" | "DOMINANT";
  message: string;
}

export function auditDecision(decision: any, personaIds: string[]): AuditFinding[] {
  const out: AuditFinding[] = [];
  const options = (decision.options ?? []) as Array<{
    persona_effects?: Array<{ persona_id?: string; delta?: Record<string, number> }>;
  }>;
  for (const p of personaIds) {
    const vecs: Array<Record<string, number>> = options.map(
      (o) => o.persona_effects?.find((e) => e.persona_id === p)?.delta ?? {},
    );
    const keys: string[] = [...new Set(vecs.flatMap((v) => Object.keys(v)))];
    if (keys.length === 0) continue;
    if (vecs.every((v) => keys.every((k) => (v[k] ?? 0) === (vecs[0][k] ?? 0)))) {
      out.push({ code: "MEANINGLESS", message: `all options identical for ${p} in ${decision.id ?? "decision"}` });
    }
    for (let i = 0; i < vecs.length; i++) {
      const dom = vecs.every((v, j) => j === i || keys.every((k) => (vecs[i][k] ?? 0) >= (v[k] ?? 0)));
      const strict = vecs.some((v, j) => j !== i && keys.some((k) => (vecs[i][k] ?? 0) > (v[k] ?? 0)));
      if (dom && strict) {
        out.push({ code: "DOMINANT", message: `option ${i} dominates for ${p} (advisory, reviewer may override)` });
        break;
      }
    }
  }
  return out;
}
```

MEANINGLESS blocks publish; DOMINANT is advisory with reviewer override (spec rule).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @app/bundle-builder exec vitest run src/bands.test.ts src/auditor.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck, then commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS all.

```bash
git add builder/src/bands.ts builder/src/bands.test.ts builder/src/auditor.ts builder/src/auditor.test.ts
git commit -m "feat(builder): band proposals + Monte Carlo + choice auditor"
```

---

### Task 9: Fuzz + full green

**Files:**
- Create: `builder/src/compile.fuzz.test.ts`

- [ ] **Step 1: Write the fuzz test (uses Task 3 + 6 only, no new code)**

```ts
import { describe, expect, it } from "vitest";
import { validateChapter } from "./index.js";
import { compile } from "./index.js";
import { mulberry32 } from "./bands.js";

function randomChapter(rand: () => number, personas: string[]): any {
  const nDec = 1 + Math.floor(rand() * 2);
  const decisions = [];
  for (let d = 0; d < nDec; d++) {
    const nOpt = 2 + Math.floor(rand() * 2);
    const options = [];
    for (let o = 0; o < nOpt; o++) {
      options.push({
        id: `d${d}o${o}`,
        label: `opt ${o}`,
        intent: `intent ${o}`,
        next: d + 1 < nDec ? `d${d + 1}` : "chapter_end",
        requires: o === 0 ? null : { all: [{ var: "x", op: ">=", value: 1 }] },
        lock_reason: "needs x",
        persona_effects: personas.map((p) => ({ persona_id: p, delta: { x: Math.floor(rand() * 5) - 2 }, outcome_text: `Outcome reaches {x} for ${p} choice ${o} text text text.` })),
      });
    }
    decisions.push({ id: `d${d}`, prompt: `prompt ${d} with enough words to pass`, options });
  }
  return { chapter_id: "fuzz", order: 0, sourcing: { mode: "invent", quote: "" }, new_variables: [], decisions, recap_hints: [] };
}

describe("fuzz", () => {
  it("never throws and valid chapters compile", () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const ch = randomChapter(rand, ["p1", "p2"]);
      const errs = validateChapter(ch, ["p1", "p2"], { x: { introduced_in: 1 } });
      expect(Array.isArray(errs)).toBe(true);
      if (errs.length === 0) {
        const out = compile({ book_id: "f", version: 1, config: { vars: [], bands: [] }, personas: [{ persona_id: "p1" }, { persona_id: "p2" }], chapters: [ch] });
        expect(out.sha).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});
```

- [ ] **Step 2: Run full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS all (9 test files).

- [ ] **Step 3: Commit**

```bash
git add builder/src/compile.fuzz.test.ts
git commit -m "test(builder): fuzz validate+compile over random chapters"
```

Fuzz outcome texts are generated at valid word length (35-word body) so the `errs.length === 0 → compile` path is actually exercised — short texts would fail `WORD_COUNT` and the compile branch would never run. Lesson carried forward: type explicitly at every `any` boundary (this toolchain does not propagate `any` through `.map` chains).

Plan 01 done when: `pnpm test` green, `pnpm typecheck` green, golden hash frozen, no network calls in any test (CI-safe), every file under 200 lines.
