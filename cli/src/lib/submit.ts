import { readFileSync, readdirSync, existsSync } from "node:fs";
import type { z } from "zod";
import { auditDecision, validateChapter } from "@app/bundle-builder";
import { CliError, readState } from "./workdir.js";

export interface SubmitCtx {
  personaIds: string[];
  ledger: Record<string, { introduced_in: number }>;
}

export interface Detail {
  code: string;
  message: string;
  nodeIds: string[];
  rule: string;
}

const RULES: Record<string, string> = {
  SCHEMA: "Output must match the pack schema exactly.",
  MISSING_PERSONA: "Per option, one delta + outcome_text per persona from the context persona list.",
  UNKNOWN_VAR: "Deltas, requires vars, and placeholders may only reference ledger keys.",
  BAD_PLACEHOLDER: "Every {placeholder} must exist in the ledger as of this chapter.",
  WORD_COUNT: "outcome_text is 40-70 words (validator tolerates 30-100).",
  NO_OPEN_OPTION: "Every decision keeps at least one option with requires:null.",
  DAG_CYCLE: "The next-graph must be acyclic and terminate at chapter_end.",
  DAG_ORPHAN: "Every decision must be reachable from the chapter entry.",
  DAG_DEAD_END: "Every path must reach chapter_end; every next target must exist.",
  DUPLICATE_ID: "Decision, option, and per-option persona ids must be unique.",
  MEANINGLESS: "Options must differ in consequence; identical deltas are filler.",
  SEGMENT_COVERAGE: "Every raw chapter must be covered exactly once across source_ranges.",
  SEGMENT_ORDER: "Sim orders must be unique and sequential from 1; titles unique.",
};

export function withRules(errs: Array<{ code: string; message: string; nodeIds?: string[] }>): Detail[] {
  return errs.map((e) => ({ code: e.code, message: e.message, nodeIds: e.nodeIds ?? [], rule: RULES[e.code] ?? "" }));
}

export function submitJson<T>(file: string, schema: z.ZodType<T>): T {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new CliError("MISSING_INPUT", `cannot read submit file: ${file}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e: any) {
    throw new CliError("VALIDATION", `submit file is not valid JSON: ${e?.message ?? e}`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new CliError(
      "VALIDATION",
      "schema check failed",
      parsed.error.issues.map((i) => ({
        code: "SCHEMA",
        message: `${i.path.join(".")}: ${i.message}`,
        nodeIds: [] as string[],
        rule: RULES.SCHEMA,
      })),
    );
  }
  return parsed.data;
}

export function approvedChapters(workdir: string): string[] {
  const dir = `${workdir}/chapters`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".approved.json"))
    .sort();
}

export function buildLedger(workdir: string): Record<string, { introduced_in: number }> {
  const ledger: Record<string, { introduced_in: number }> = {};
  try {
    const personas = readState<{ personas?: Array<{ starting_state?: Record<string, number> }> }>(workdir, "personas.json");
    for (const p of personas.personas ?? []) {
      for (const k of Object.keys(p.starting_state ?? {})) ledger[k] ??= { introduced_in: 1 };
    }
  } catch {
    // No personas yet (segment stage) — empty ledger is correct.
  }
  for (const f of approvedChapters(workdir)) {
    const ch = readState<any>(workdir, `chapters/${f}`);
    for (const v of ch.new_variables ?? []) {
      if (typeof v?.key === "string") ledger[v.key] ??= { introduced_in: ch.order ?? 0 };
    }
  }
  return ledger;
}

export function personaIdsOf(workdir: string): string[] {
  try {
    const personas = readState<{ personas?: Array<{ persona_id?: string }> }>(workdir, "personas.json");
    return (personas.personas ?? []).map((p) => p.persona_id).filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function submitChapterData(workdir: string, data: any): { warnings: string[] } {
  const ctx: SubmitCtx = { personaIds: personaIdsOf(workdir), ledger: buildLedger(workdir) };
  const errs = validateChapter(data, ctx.personaIds, ctx.ledger);
  if (errs.length > 0) {
    throw new CliError("VALIDATION", `${errs.length} chapter check(s) failed`, withRules(errs));
  }
  // Auditor runs per decision: MEANINGLESS blocks, DOMINANT is advisory.
  const warnings: string[] = [];
  for (const d of data.decisions ?? []) {
    for (const a of auditDecision(d, ctx.personaIds)) {
      if (a.code === "MEANINGLESS") {
        throw new CliError("VALIDATION", "meaningless choice detected", withRules([{ ...a, nodeIds: [d.id] }]));
      }
      warnings.push(`${a.code}: ${a.message}`);
    }
  }
  return { warnings };
}
