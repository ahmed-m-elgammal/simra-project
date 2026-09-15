import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { CliError } from "./workdir.js";

export const PACK_FORMAT = 1 as const;

// Schema single-sourcing without conversion libraries: the pack embeds the
// actual Zod source text the submit side validates against. No drift possible:
// if the schema file changes, every future pack changes with it.
let cachedSource: string | null = null;

export function builderSchemasSource(): string {
  if (cachedSource) return cachedSource;
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("@app/bundle-builder/package.json");
  cachedSource = readFileSync(join(dirname(pkgPath), "src", "schemas.ts"), "utf8");
  return cachedSource;
}

export const CHAPTER_CONSTRAINTS = [
  "Decide counts from the chapter content (typically 1-2 decisions, 2-3 options each). No fixed quotas.",
  "Reuse an existing ledger key whenever meaning overlaps. New keys only for genuinely new tracking, each with key/label/type/range/display/default_value and a distinction_note when close to an existing var.",
  "Every option carries requires (null = always available, or {all|any|not} of {var,op,value}) plus a human lock_reason. Every decision keeps at least one option with requires:null.",
  "Per option, one delta + outcome_text per persona from the context persona list. outcome_text is 40-70 words with at least one {var} placeholder that exists in the ledger as of this chapter. No raw numbers outside placeholders.",
  "Deltas, requires vars, and placeholders may only reference ledger keys. Every {placeholder} must exist.",
].join("\n");

export const SEGMENT_CONSTRAINTS = [
  "Cover every raw chapter exactly once across source_ranges. Titles are unique.",
  "Each sim chapter gets a one-line teaching_point reused by later stages.",
  "Merge only chapters with no distinct teaching point; split only chapters with two or more.",
].join("\n");

export const PERSONAS_CONSTRAINTS = [
  "Decide count and shape from the book (2 or more). Names, stories, and starting numbers follow the content, not a template.",
  "starting_state seeds only variables anticipatable now. Descriptions freeze at approval and are never rewritten later.",
].join("\n");

export const BANDS_CONSTRAINTS = [
  "Propose 2-3 bands per variable family from the observed delta ranges in context.",
  "Predicates use {all|any|not} of {var,op,value} with ops ==,!=,<,<=,>,>= over ledger keys only.",
].join("\n");

export interface PackEnvelope {
  pack_format: 1;
  stage: "segment" | "personas" | "chapter" | "bands";
  book_id: string;
  locale: string;
  task: string;
  schemaSource: string;
  constraints: string;
  context: Record<string, unknown>;
  chapter?: { order: number; title: string; source_ranges: string[]; source_text: string };
}

interface RawChapter {
  id: string;
  title: string;
  text: string;
}

interface SimChapter {
  order: number;
  title: string;
  source_ranges: string[];
  rationale: string;
  teaching_point: string;
}

function textForRanges(raw: RawChapter[], ranges: string[]): string {
  return ranges
    .map((r) => {
      const found = raw.find((c) => c.id === r);
      if (!found) throw new CliError("MISSING_INPUT", `source range not in raw chapters: ${r}`);
      return found.text;
    })
    .join("\n\n");
}

export function buildSegmentPack(input: { book_id: string; locale: string; raw: RawChapter[] }): PackEnvelope {
  return {
    pack_format: PACK_FORMAT,
    stage: "segment",
    book_id: input.book_id,
    locale: input.locale,
    task: "Propose the simulation chapter list for this book.",
    schemaSource: builderSchemasSource(),
    constraints: SEGMENT_CONSTRAINTS,
    context: { raw_chapters: input.raw },
  };
}

export function buildPersonasPack(input: {
  book_id: string;
  locale: string;
  raw: RawChapter[];
  sim: { sim_chapters: SimChapter[] };
}): PackEnvelope {
  return {
    pack_format: PACK_FORMAT,
    stage: "personas",
    book_id: input.book_id,
    locale: input.locale,
    task: "Generate the persona set for the whole book plus its one-line teaching goal.",
    schemaSource: builderSchemasSource(),
    constraints: PERSONAS_CONSTRAINTS,
    context: {
      sim_chapters: input.sim.sim_chapters,
      raw_overview: input.raw.map((c) => ({ id: c.id, title: c.title, excerpt: c.text.slice(0, 800) })),
    },
  };
}

export function buildChapterPack(input: {
  book_id: string;
  locale: string;
  chapterOrder: number;
  raw: RawChapter[];
  sim: { sim_chapters: SimChapter[] };
  personas: { teaching_goal: string; personas: unknown[] };
  prior: unknown[];
  ledger: Record<string, { introduced_in: number }>;
}): PackEnvelope {
  const sim = input.sim.sim_chapters.find((s) => s.order === input.chapterOrder);
  if (!sim) throw new CliError("MISSING_INPUT", `no sim chapter with order ${input.chapterOrder} (approve segmentation first)`);
  return {
    pack_format: PACK_FORMAT,
    stage: "chapter",
    book_id: input.book_id,
    locale: input.locale,
    task: `Write the canonical JSON for simulation chapter ${sim.order} ("${sim.title}"). Teaching point: ${sim.teaching_point}`,
    schemaSource: builderSchemasSource(),
    constraints: CHAPTER_CONSTRAINTS,
    context: {
      ledger: input.ledger,
      personas: input.personas.personas,
      teaching_goal: input.personas.teaching_goal,
      prior_chapters: input.prior,
    },
    chapter: {
      order: sim.order,
      title: sim.title,
      source_ranges: sim.source_ranges,
      source_text: textForRanges(input.raw, sim.source_ranges),
    },
  };
}

export function observedRanges(prior: Array<{ decisions?: Array<{ options?: Array<{ persona_effects?: Array<{ delta?: Record<string, number> }> }> }> }>): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const ch of prior) {
    for (const d of ch.decisions ?? []) {
      for (const o of d.options ?? []) {
        for (const e of o.persona_effects ?? []) {
          for (const [k, v] of Object.entries(e.delta ?? {})) {
            const cur = out[k] ?? { min: v, max: v };
            out[k] = { min: Math.min(cur.min, v), max: Math.max(cur.max, v) };
          }
        }
      }
    }
  }
  return out;
}

export function buildBandsPack(input: {
  book_id: string;
  locale: string;
  prior: Array<{ decisions?: Array<{ options?: Array<{ persona_effects?: Array<{ delta?: Record<string, number> }> }> }> }>;
  ledger: Record<string, { introduced_in: number }>;
}): PackEnvelope {
  return {
    pack_format: PACK_FORMAT,
    stage: "bands",
    book_id: input.book_id,
    locale: input.locale,
    task: "Write the evaluation_bands for the whole book from the observed delta ranges.",
    schemaSource: builderSchemasSource(),
    constraints: BANDS_CONSTRAINTS,
    context: { ledger: input.ledger, observed_ranges: observedRanges(input.prior) },
  };
}
