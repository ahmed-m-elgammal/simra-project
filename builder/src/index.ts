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
    | "WORD_COUNT";
  message: string;
  nodeIds: string[];
}

import { checkDag } from "./dag.js";
import { checkOpenOption } from "./gating.js";
import { countWords, keyExists, placeholderVars, requiresVars, type Ledger } from "./ledger.js";

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
  const errs: ValidationError[] = [...checkDag(decisions), ...checkOpenOption(decisions)];
  for (const d of decisions) {
    for (const o of d.options) {
      const have = new Set(o.persona_effects.map((e) => e.persona_id));
      for (const p of personaIds) {
        if (!have.has(p)) errs.push({ code: "MISSING_PERSONA", message: `option ${o.id} missing persona ${p}`, nodeIds: [o.id] });
      }
      for (const v of requiresVars(o.requires)) {
        if (!keyExists(ledger, v)) errs.push({ code: "UNKNOWN_VAR", message: `requires var not in ledger: ${v}`, nodeIds: [o.id] });
      }
      for (const e of o.persona_effects) {
        for (const k of Object.keys(e.delta ?? {})) {
          if (!keyExists(ledger, k)) errs.push({ code: "UNKNOWN_VAR", message: `delta key not in ledger: ${k}`, nodeIds: [o.id] });
        }
        for (const v of placeholderVars(e.outcome_text)) {
          if (!keyExists(ledger, v)) errs.push({ code: "BAD_PLACEHOLDER", message: `placeholder not in ledger: {${v}}`, nodeIds: [o.id] });
        }
        const words = countWords(e.outcome_text);
        if (words < WORD_MIN || words > WORD_MAX) {
          errs.push({ code: "WORD_COUNT", message: `outcome_text has ${words} words (need ${WORD_MIN}-${WORD_MAX}): ${o.id}/${e.persona_id}`, nodeIds: [o.id] });
        }
      }
    }
  }
  return errs;
}
