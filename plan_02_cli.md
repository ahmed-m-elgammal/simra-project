# Plan 02 — bookforge CLI (agent-driven, no LLM API)

> For agentic workers: implement task-by-task in order. Steps use checkbox (`- [ ]`) syntax. Do not skip tests; do not commit red. Depends on Plan 01 (`@app/bundle-builder` importable from the workspace).

**Goal:** A CLI where every generative stage is a prompt/submit pair: CLI assembles prompt packs, any driving agent writes JSON, CLI validates and stores. Plus human approve gates, local validate/build, and publish with dry-run.

**Architecture:** `citty` subcommands, lazy-loaded. Pure pack-builder functions (golden-tested) + thin command shells (arg parsing, files, exit codes). Machine contract: `--format json` → strict JSON on stdout, human text on stderr; exit `0` ok, `2` validation errors (JSON body on stdout), `3` missing inputs, `4` missing human decision data. Interactive TTY uses `@clack/prompts` for approve/reject; non-TTY requires explicit flags (`--approve`, `--note`) so agents never hang on a prompt.

**Tech Stack:** TypeScript strict, `citty`, `@clack/prompts`, `unpdf` (behind an extractor interface; stub in tests), `zod`, `vitest`. Reuses `@app/bundle-builder` for all validation and compile.

**Layout this plan creates:**

```
cli/src/index.ts                 # citty root, lazy subcommands
cli/src/lib/workdir.ts           # workdir paths, read/write JSON state, exit-code errors
cli/src/lib/extract.ts           # extractor interface + unpdf adapter (manual-tested) + stub (tests)
cli/src/lib/split.ts             # raw text → raw chapters (pure, golden-tested)
cli/src/commands/init.ts         # init
cli/src/commands/ingest.ts       # ingest
cli/src/commands/segment.ts      # segment prompt|submit|approve|request-changes
cli/src/commands/personas.ts     # personas prompt|submit
cli/src/commands/chapter.ts      # chapter prompt|submit|approve|request-changes
cli/src/commands/bands.ts        # bands prompt|submit
cli/src/commands/validate.ts     # full-workdir validation
cli/src/commands/build.ts        # deterministic bundle build
cli/src/commands/publish.ts      # dry-run + publish (adapters faked in tests)
cli/src/lib/adapters.ts          # Storage + DB interfaces, fake implementations
cli/fixtures/minibook/           # raw_chapters.json, sim stub, 2 approved chapters, agent outputs, golden bundle hash
```

Prompt packs are versioned (`pack_format: 1`) and contain: task, JSON schema (inline, from builder Zod via `zod-to-json-schema`-free hand mirror — NO, rule: schemas are the single source; packs embed `JSON.stringify(zodToJsonSchema(...))` using the `zod-to-json-schema` package, locked dependency), constraints text, ledger snapshot, relevant approved history. Agents return JSON matching the schema; submit validates with the same Zod objects.

New locked dependency: `zod-to-json-schema` (schema single-sourcing for packs).

---

### Task 1: CLI scaffold + workdir lib

**Files:**
- Create: `cli/package.json`, `cli/src/index.ts`, `cli/src/lib/workdir.ts`
- Test: `cli/src/lib/workdir.test.ts`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "bookforge",
  "version": "0.1.0",
  "type": "module",
  "bin": { "bookforge": "./dist/index.js" },
  "scripts": { "test": "vitest run", "build": "tsc -p tsconfig.json" },
  "dependencies": { "citty": "^0.2.2", "@clack/prompts": "^1.8.1", "zod": "^3.23.0", "zod-to-json-schema": "^3.23.0", "unpdf": "^1.0.0" }
}
```

Locked citty facts (v0.2.2, verified): `runCommand(cmd, { rawArgs })` resolves `{ result }` (the `run()` return), rejects on thrown errors — tests assert on `result`. Front matter (e.g. FOREWORD) becomes its own segment; segmentation decides what to use. Init resolves the PDF path from CWD; tests pass absolute paths.

- [ ] **Step 2: Write failing workdir test**

```ts
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, writeState, statePath } from "./workdir.js";

describe("workdir", () => {
  it("round-trips JSON state and reports missing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    expect(() => readState(dir, "sim_chapters.json")).toThrow(/MISSING_INPUT/);
    writeState(dir, "sim_chapters.json", { ok: true });
    expect(readState(dir, "sim_chapters.json")).toEqual({ ok: true });
    expect(statePath(dir, "x.json").endsWith("x.json")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter bookforge exec vitest run src/lib/workdir.test.ts`
Expected: FAIL with "Cannot find module './workdir.js'".

- [ ] **Step 4: Write minimal implementation**

```ts
export class CliError extends Error {
  constructor(
    public code: "MISSING_INPUT" | "VALIDATION" | "GATE_OPEN" | "ABORTED",
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}

export function statePath(workdir: string, name: string): string {
  return `${workdir}/${name}`;
}

export function writeState(workdir: string, name: string, data: unknown): void {
  const { writeFileSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(workdir, { recursive: true });
  writeFileSync(statePath(workdir, name), JSON.stringify(data, null, 2));
}

export function readState<T>(workdir: string, name: string): T {
  const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
  const p = statePath(workdir, name);
  if (!existsSync(p)) throw new CliError("MISSING_INPUT", `missing required state file: ${name} (run the earlier stage first)`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
}
```

Use static `import` (not `require`) in the real file — ESM only. Shape above is exact; keep error codes, tests and agents depend on them.

- [ ] **Step 5: Write citty root with lazy subcommands**

```ts
import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: { name: "bookforge", version: "0.1.0", description: "Raw book in, client-ready bundle out. Agent-driven: no LLM API." },
  subCommands: {
    init: () => import("./commands/init.js").then((m) => m.default),
    ingest: () => import("./commands/ingest.js").then((m) => m.default),
    segment: () => import("./commands/segment.js").then((m) => m.default),
    personas: () => import("./commands/personas.js").then((m) => m.default),
    chapter: () => import("./commands/chapter.js").then((m) => m.default),
    bands: () => import("./commands/bands.js").then((m) => m.default),
    validate: () => import("./commands/validate.js").then((m) => m.default),
    build: () => import("./commands/build.js").then((m) => m.default),
    publish: () => import("./commands/publish.js").then((m) => m.default),
  },
});

runMain(main);
```

Global flags on every command: `--workdir` (required), `--format json|human` (default human on TTY, json when piped). Exit mapping: `CliError` code MISSING_INPUT → 3, VALIDATION → 2, GATE_OPEN/ABORTED → 4; `--format json` prints `{ ok:false, code, message, details }` on stdout.

Scaffold rule: every lazily-imported command file exists from Task 1 as a typed stub (throws `ABORTED` "not implemented yet") so `pnpm typecheck` stays green while Tasks 2-6 land. Stubs are replaced, never extended, by their task.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter bookforge exec vitest run src/lib/workdir.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/package.json cli/src/index.ts cli/src/lib/workdir.ts cli/src/lib/workdir.test.ts
git commit -m "feat(cli): citty scaffold + workdir state + exit codes"
```

---

### Task 2: init + ingest (extractor interface, pure splitter)

**Files:**
- Create: `cli/src/commands/init.ts`, `cli/src/commands/ingest.ts`, `cli/src/lib/extract.ts`, `cli/src/lib/split.ts`
- Test: `cli/src/lib/split.test.ts`, `cli/src/commands/ingest.test.ts` (runs `runCommand` with stub extractor)

- [ ] **Step 1: Write the failing splitter test**

```ts
import { describe, expect, it } from "vitest";
import { splitChapters } from "./split.js";

const TEXT = "FOREWORD\nblah\nCHAPTER 1\nIntro text here.\nCHAPTER 2\nMore text.\nCHAPTER 3\nEnd.";

describe("splitChapters", () => {
  it("detects chapter markers and keeps offsets", () => {
    const out = splitChapters(TEXT);
    expect(out.map((c) => c.title)).toEqual(["CHAPTER 1", "CHAPTER 2", "CHAPTER 3"]);
    expect(out[0].char_start).toBeGreaterThan(0);
    expect(out[2].char_end).toBe(TEXT.length);
    expect(out[0].text).toContain("Intro text");
  });
  it("throws a machine error when no markers found", () => {
    expect(() => splitChapters("no markers at all here")).toThrow(/NO_CHAPTER_MARKERS/);
  });
});
```

Marker rule (locked): lines matching `^(chapter|ch\.?|part)\s+\d+` case-insensitive, plus all-caps short lines (<60 chars) as fallback markers. Both recorded per chapter (`marker_type: regex|fallback`). No LLM in this step, ever.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter bookforge exec vitest run src/lib/split.test.ts`
Expected: FAIL with "Cannot find module './split.js'".

- [ ] **Step 3: Write minimal splitter**

```ts
export interface RawChapter {
  id: string;
  title: string;
  text: string;
  char_start: number;
  char_end: number;
  marker_type: "regex" | "fallback";
}

const MARKER = /^(chapter|ch\.?|part)\s+\d+.*$/i;

export function splitChapters(fullText: string): RawChapter[] {
  const lines = fullText.split("\n");
  const marks: Array<{ line: number; title: string; type: "regex" | "fallback" }> = [];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (MARKER.test(t)) marks.push({ line: i, title: t, type: "regex" });
    else if (t.length > 0 && t.length < 60 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
      marks.push({ line: i, title: t, type: "fallback" });
    }
  });
  if (marks.length === 0) throw new Error("NO_CHAPTER_MARKERS: no chapter markers detected — check the PDF extraction");
  let cursor = 0;
  return marks.map((m, i) => {
    const start = fullText.indexOf(lines[m.line], cursor);
    const nextStart = i + 1 < marks.length ? fullText.indexOf(lines[marks[i + 1].line], start + 1) : fullText.length;
    const end = nextStart === -1 ? fullText.length : nextStart;
    cursor = end;
    return { id: `raw_ch_${i + 1}`, title: m.title, text: fullText.slice(start, end).trim(), char_start: start, char_end: end, marker_type: m.type };
  });
}
```

- [ ] **Step 4: Write extractor interface + commands**

```ts
// lib/extract.ts
export interface Extractor {
  extractText(pdfBytes: Uint8Array): Promise<{ pages: string[] }>;
}

export class UnpdfExtractor implements Extractor {
  async extractText(pdfBytes: Uint8Array): Promise<{ pages: string[] }> {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
    const { text } = await extractText(pdf, { mergePages: false });
    return { pages: (Array.isArray(text) ? text : [text]) as string[] };
  }
}

export class StubExtractor implements Extractor {
  constructor(private fixture: string[]) {}
  async extractText(_pdfBytes: Uint8Array): Promise<{ pages: string[] }> {
    return { pages: this.fixture };
  }
}
```

`init`: writes `bookforge.config.json` (`{ book_id, locale, thresholds: { dupFlag: 0.85, dupNote: 0.7 }, pack_format: 1 }`) + copies input PDF path into config. Validates locale against `en|ar` (phase 1).

`ingest`: reads PDF bytes → extractor → join pages → `splitChapters` → writes `raw_chapters.json` (`[{id,title,char_start,char_end,marker_type}]` + full text to `raw_full.txt`). Prints `{ ok:true, chapters: N, markers: {regex: a, fallback: b} }`. Unpdf adapter is manual-tested on a real PDF once (record filename + page count in the commit message); CI uses `StubExtractor`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter bookforge exec vitest run src/lib/split.test.ts src/commands/ingest.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/init.ts cli/src/commands/ingest.ts cli/src/lib/extract.ts cli/src/lib/split.ts cli/src/lib/split.test.ts cli/src/commands/ingest.test.ts
git commit -m "feat(cli): init + ingest with extractor interface"
```

---

### Task 3: Prompt-pack builders (deterministic, golden-tested)

**Files:**
- Create: `cli/src/lib/packs.ts`
- Test: `cli/src/lib/packs.test.ts`
- Create: `cli/fixtures/minibook/` (raw_chapters.json, sim_chapters.json, personas.json, chapters/01.json approved)

Pack contract (locked): `{ pack_format: 1, stage, book_id, locale, task, schema (JSON Schema from the builder Zod objects via zod-to-json-schema), constraints (verbatim rules for the stage), context (ledger, personas, prior approved chapters, thresholds), output_shape_hint }`. Builders are pure functions of workdir state — byte-stable goldens on the minibook fixture.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildChapterPack } from "./packs.js";
import { readFileSync } from "node:fs";

const state = (n: string) => JSON.parse(readFileSync(`fixtures/minibook/${n}`, "utf8"));

describe("packs", () => {
  it("chapter pack embeds schema + ledger + prior chapters + constraints", () => {
    const pack = buildChapterPack({ book_id: "mini", locale: "en", chapterOrder: 2, raw: state("raw_chapters.json"), sim: state("sim_chapters.json"), personas: state("personas.json"), prior: [state("chapters/01.json")], ledger: { consistency: { introduced_in: 1 } } });
    expect(pack.pack_format).toBe(1);
    expect(JSON.stringify(pack.schema)).toContain("persona_effects");
    expect(JSON.stringify(pack.constraints)).toContain("requires");
    expect(pack.context.prior_chapters).toHaveLength(1);
    expect(pack.context.ledger.consistency.introduced_in).toBe(1);
  });
  it("packs are byte-stable (golden)", () => {
    const pack = buildChapterPack({ book_id: "mini", locale: "en", chapterOrder: 2, raw: state("raw_chapters.json"), sim: state("sim_chapters.json"), personas: state("personas.json"), prior: [state("chapters/01.json")], ledger: { consistency: { introduced_in: 1 } } });
    const golden = readFileSync("fixtures/minibook/chapter02.pack.golden.json", "utf8");
    expect(JSON.stringify(pack)).toBe(golden.trim());
  });
});
```

Generate the golden once from the implementation, eyeball it (schema present, no book text leaked beyond the chapter's own source ranges), then freeze.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter bookforge exec vitest run src/lib/packs.test.ts`
Expected: FAIL with "Cannot find module './packs.js'".

- [ ] **Step 3: Write minimal builders** (`buildSegmentPack`, `buildPersonasPack`, `buildChapterPack`, `buildBandsPack` — same shape, different task/constraints/context; segment pack includes full raw text + marker report; personas pack includes locked sim chapters; chapter pack includes only its `source_ranges` text + current ledger + personas + prior approved chapters + teaching goal; bands pack includes full ledger + per-var observed delta ranges + Monte Carlo summary from builder `monteCarlo`).

Constraint texts are verbatim excerpts of the pipeline rules (dynamic counts, reuse-first variables, 40-70 word outcomes with `{var}`, ≥1 `requires:null` option, no minified keys). They live as exported string constants so submit-side error messages can quote the exact rule broken.

- [ ] **Step 4: Generate golden, eyeball, freeze; run test to verify it passes**

Run: `pnpm --filter bookforge exec vitest run src/lib/packs.test.ts`
Expected: PASS after golden written.

- [ ] **Step 5: Commit**

```bash
git add cli/src/lib/packs.ts cli/src/lib/packs.test.ts cli/fixtures/minibook/
git commit -m "feat(cli): deterministic prompt-pack builders + goldens"
```

---

### Task 4: Submit + approve commands (machine errors agents self-correct from)

**Files:**
- Create: `cli/src/commands/segment.ts`, `cli/src/commands/personas.ts`, `cli/src/commands/chapter.ts`, `cli/src/commands/bands.ts`
- Test: `cli/src/commands/submit.test.ts` (uses `runCommand` from citty with `--format json`, asserts exit codes + error JSON shape)

Submit flow (identical per stage): read `--file` JSON → Zod-parse with the builder schema → run builder validators (ledger/DAG/gating/placeholders against workdir state) → on fail print `{ ok:false, code:"VALIDATION", message, details:[{code, message, nodeIds, rule}] }` exit 2 → on pass store (`sim_chapters.json` proposed, `personas.json`, `chapters/NN.json`, `bands.json`) exit 0 with `{ ok:true, stored, warnings }`. `details[].rule` quotes the violated constraint constant from Task 3 so the driving agent can fix without a human.

Approve flow: `approve` requires the corresponding proposed file + no open validation errors (re-check; exit 4 `GATE_OPEN` otherwise) → copies to `*.approved.json` (segment lock, chapter lock). `request-changes --note "..."` appends to `history/NN.notes.jsonl` (kept forever; next prompt pack includes full history). Interactive TTY without `--approve`/`--note` uses clack confirm/text; non-TTY without flags exits 4 with `{ ok:false, code:"ABORTED", message:"non-interactive: pass --approve or request-changes --note" }`. Clack rendering itself is manual-tested once; all logic paths are flag-tested in CI.

- [ ] **Step 1: Write the failing test** (submit invalid chapter JSON → exit 2 + error codes array contains `MISSING_PERSONA`; submit valid minibook chapter-02 agent output → exit 0 + file stored). Check in `fixtures/minibook/agent-chapter02-good.json` + `agent-chapter02-bad.json` (bad = option missing `omar` effect).

- [ ] **Step 2: Run test to verify it fails** (commands missing).

- [ ] **Step 3: Write the four command files** sharing one `submitFlow` helper in `lib/submit.ts` (also created + committed here).

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/segment.ts cli/src/commands/personas.ts cli/src/commands/chapter.ts cli/src/commands/bands.ts cli/src/lib/submit.ts cli/src/commands/submit.test.ts cli/fixtures/minibook/agent-*.json
git commit -m "feat(cli): submit+approve flows with machine-readable errors"
```

---

### Task 5: validate + build commands (wire the builder)

**Files:**
- Create: `cli/src/commands/validate.ts`, `cli/src/commands/build.ts`
- Test: `cli/src/commands/build.test.ts` (runs both on `fixtures/minibook`, asserts golden bundle hash)

`validate`: loads all approved state → runs every builder check (schemas, ledger, DAG per chapter, gating, placeholders, duplicates screen with FakeEmbeddings in tests / real provider flag `--embeddings local` default in real runs, auditor MEANINGLESS-blocking / DOMINANT-advisory, coverage) → prints `{ ok:true, chapters }` or `{ ok:false, code:"VALIDATION", details }` exit 2.

`build`: requires validate-green → assembles book object → `compile()` → writes `bundle-{book}-{locale}-vN.json` + `.br` + `.gz` + prints `{ ok:true, sha, bytes, wire_br }`. Version N = max approved bundle_version + 1 from `bookforge.config.json` (`next_version` field, bumped only by successful build). Pure local, no network, no keys — assert in test via env scrub (delete `SUPABASE_*`/`HTTPS_PROXY` and still pass).

- [ ] **Step 1: Write the failing test** (build on minibook → hash equals `fixtures/minibook/bundle.golden.hash`; check the golden file in).

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write both commands.**

- [ ] **Step 4: Generate golden hash once, freeze, run test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/validate.ts cli/src/commands/build.ts cli/src/commands/build.test.ts cli/fixtures/minibook/bundle.golden.hash
git commit -m "feat(cli): validate + deterministic build wired to builder"
```

---

### Task 6: publish dry-run + publish (faked adapters in tests)

**Files:**
- Create: `cli/src/lib/adapters.ts`, `cli/src/commands/publish.ts`
- Test: `cli/src/commands/publish.test.ts`

`adapters.ts`: `StorageAdapter { uploadImmutable(name, bytes, etag): Promise<url> }`, `DbAdapter { getBundleVersion(book): Promise<number>, setPublished(...): Promise<void>, bumpVersion(...): Promise<number> }`, `FakeStorage` (in-memory map, records headers for assertions), `FakeDb` (in-memory versions), `SupabaseAdapters` (thin `supabase-js` wrapper, service key from env only, manual-tested once against a scratch project — record project ref + test file name in the commit message, never commit keys).

`publish --dry-run`: prints exactly what would flip (chapters, version N→N+1, sha, target URL shape, push cohort size computed from a local `progress.json` stand-in if present) and changes nothing. `publish`: requires clean `validate` + fresh `build` hash match → row-lock version bump → upload → pointer swap → print `{ ok:true, version, url, sha }`. Order locked: upload first, swap second (spec rule).

- [ ] **Step 1: Write the failing test** (dry-run changes nothing in FakeDb/FakeStorage; publish with fakes bumps version, stores bytes with immutable headers, returns url; second identical publish skips upload by hash).

- [ ] **Step 2: Run test to verify it fails.**

- [ ] **Step 3: Write adapters + command.**

- [ ] **Step 4: Run test to verify it passes.**

- [ ] **Step 5: Full CLI suite + typecheck, then commit**

Run: `pnpm --filter bookforge exec vitest run && pnpm typecheck`
Expected: PASS all.

```bash
git add cli/src/lib/adapters.ts cli/src/commands/publish.ts cli/src/commands/publish.test.ts
git commit -m "feat(cli): publish dry-run + idempotent publish"
```

Plan 02 done when: `init→ingest→segment→personas→chapter→bands→validate→build→publish` runs end-to-end on the minibook fixture using only checked-in fake agent outputs (no LLM, no network, no keys), golden bundle hash frozen, every file under 200 lines, agents get machine-readable errors on every failure path.
