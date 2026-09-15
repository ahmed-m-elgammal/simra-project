export function version(): string {
  return "0.1.0";
}

export interface ValidationError {
  code:
    | "DAG_CYCLE"
    | "DAG_ORPHAN"
    | "DAG_DEAD_END"
    | "UNKNOWN_VAR"
    | "MISSING_PERSONA"
    | "NO_OPEN_OPTION"
    | "BAD_PLACEHOLDER"
    | "WORD_COUNT"
    | "DUPLICATE_ID";
  message: string;
  nodeIds: string[];
}

import { checkDag } from "./dag.js";
import { checkDuplicateIds } from "./ids.js";
import { checkOpenOption } from "./gating.js";
import { countWords, keyExists, placeholderVars, requiresVars, type Ledger } from "./ledger.js";
import { normalizeChapter } from "./normalize.js";
import { compileBand, compileRequires } from "./precompile.js";
import { minifyBundle } from "./minify.js";

export { CanonicalChapterSchema, RequiresSchema } from "./schemas.js";
export { auditDecision, type AuditFinding } from "./auditor.js";
export { compileBand, compileRequires } from "./precompile.js";
export { TransformersEmbeddings } from "./embeddings/transformers.js";
export { FakeEmbeddings } from "./embeddings/fake.js";
export { screenDuplicates, screenDuplicatesAsync, type DuplicateFinding } from "./duplicates.js";
export type { EmbeddingProvider } from "./embeddings/types.js";
export type { Ledger };

const WORD_MIN = 30;
const WORD_MAX = 100;

export function validateChapter(chapter: any, personaIds: string[], ledger: Ledger): ValidationError[] {
  const decisions = (chapter.decisions ?? []) as Array<{
    id: string;
    options: Array<{
      id: string;
      next: string;
      requires: unknown;
      persona_effects: Array<{ persona_id: string; delta: Record<string, number>; outcome_text: string }>;
    }>;
  }>;
  const errs: ValidationError[] = [...checkDuplicateIds(decisions), ...checkDag(decisions), ...checkOpenOption(decisions)];
  for (const d of decisions) {
    for (const o of d.options ?? []) {
      const effects = o.persona_effects ?? [];
      const have = new Set(effects.map((e) => e.persona_id));
      for (const p of personaIds) {
        if (!have.has(p)) errs.push({ code: "MISSING_PERSONA", message: `option ${o.id} missing persona ${p}`, nodeIds: [o.id] });
      }
      for (const v of requiresVars(o.requires)) {
        if (!keyExists(ledger, v)) errs.push({ code: "UNKNOWN_VAR", message: `requires var not in ledger: ${v}`, nodeIds: [o.id] });
      }
      for (const e of effects) {
        for (const k of Object.keys(e.delta ?? {})) {
          if (!keyExists(ledger, k)) errs.push({ code: "UNKNOWN_VAR", message: `delta key not in ledger: ${k}`, nodeIds: [o.id] });
        }
        const text = typeof e.outcome_text === "string" ? e.outcome_text : "";
        for (const v of placeholderVars(text)) {
          if (!keyExists(ledger, v)) errs.push({ code: "BAD_PLACEHOLDER", message: `placeholder not in ledger: {${v}}`, nodeIds: [o.id] });
        }
        const words = countWords(text);
        if (words < WORD_MIN || words > WORD_MAX) {
          errs.push({ code: "WORD_COUNT", message: `outcome_text has ${words} words (need ${WORD_MIN}-${WORD_MAX}): ${o.id}/${e.persona_id}`, nodeIds: [o.id] });
        }
      }
    }
  }
  return errs;
}

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
    config: {
      ...book.config,
      bands_compiled: (book.config.bands ?? []).map((b: any) => ({ key: b.key, fn: compileBand(b.predicate) })),
    },
    personasById: Object.fromEntries(book.personas.map((p: any) => [p.persona_id, p])),
    chaptersById,
  };
  return minifyBundle(bundle);
}
