import { defineCommand } from "citty";
import {
  CanonicalChapterSchema,
  compileBand,
  FakeEmbeddings,
  TransformersEmbeddings,
  screenDuplicatesAsync,
} from "@app/bundle-builder";
import { CliError, readState } from "../lib/workdir.js";
import { approvedChapters, buildLedger, submitChapterData, submitJson, withRules } from "../lib/submit.js";
import { checkSegmentation } from "./segment.js";
import { BandsSchema } from "./bands.js";
import { assembleBook } from "../lib/assemble.js";

export interface ValidateOpts {
  embeddings?: "fake" | "local";
}

export async function runValidate(workdir: string, opts: ValidateOpts = {}): Promise<{ ok: true; chapters: number; warnings: string[] }> {
  const warnings: string[] = [];
  const raw = readState<Array<{ id: string }>>(workdir, "raw_chapters.json");
  const sim = readState<{ sim_chapters: Array<{ order: number; title: string; source_ranges: string[] }> }>(workdir, "sim_chapters.approved.json");

  const segErrs = checkSegmentation(sim, raw.map((r) => r.id));
  if (segErrs.length > 0) throw new CliError("VALIDATION", "segmentation re-check failed", segErrs);

  const files = approvedChapters(workdir);
  if (files.length !== sim.sim_chapters.length) {
    throw new CliError("VALIDATION", `approved chapters (${files.length}) do not match locked segmentation (${sim.sim_chapters.length})`, withRules([{ code: "CHAPTER_GAP", message: "approve every sim chapter before validating", nodeIds: [] }]));
  }
  for (const f of files) {
    const data = readState<any>(workdir, `chapters/${f}`);
    const parsed = CanonicalChapterSchema.safeParse(data);
    if (!parsed.success) {
      throw new CliError(
        "VALIDATION",
        `schema check failed for ${f}`,
        parsed.error.issues.map((i) => ({ code: "SCHEMA", message: `${i.path.join(".")}: ${i.message}`, nodeIds: [f], rule: "Output must match the pack schema exactly." })),
      );
    }
    const { warnings: w } = submitChapterData(workdir, data);
    warnings.push(...w.map((m) => `${f}: ${m}`));
  }

  // Duplicate screen over declared vars (gloss = label; reviewer owns merge/keep,
  // so flag verdicts block and note verdicts warn).
  const book = assembleBook(workdir);
  const provider = opts.embeddings === "fake" ? new FakeEmbeddings({}) : new TransformersEmbeddings();
  const dupes = await screenDuplicatesAsync(
    book.config.vars.map((v) => ({ key: v.key, gloss: `${v.label} (${v.key})` })),
    provider,
  );
  for (const d of dupes) {
    if (d.verdict === "flag") {
      throw new CliError("VALIDATION", `possible duplicate variables: ${d.a} ~ ${d.b} (score ${d.score.toFixed(2)})`, withRules([{ code: "DUPLICATE_VAR", message: `merge ${d.a} and ${d.b}, or record a distinction note`, nodeIds: [d.a, d.b] }]));
    }
    if (d.verdict === "note") warnings.push(`similar variables ${d.a} ~ ${d.b} (${d.score.toFixed(2)}): confirm distinction at review`);
  }

  const bands = submitJson(`${workdir}/bands.json`, BandsSchema) as { bands: Array<{ key: string; predicate: unknown }> };
  const keys = Object.keys(buildLedger(workdir));
  for (const b of bands.bands) {
    try {
      compileBand(b.predicate, keys);
    } catch (e: any) {
      throw new CliError("VALIDATION", `band failed to compile: ${b.key}`, withRules([{ code: "UNKNOWN_VAR", message: e?.message ?? String(e), nodeIds: [b.key] }]));
    }
  }
  return { ok: true, chapters: files.length, warnings };
}

export default defineCommand({
  meta: { name: "validate", description: "Validate the full approved workdir." },
  args: {
    workdir: { type: "string" as const, description: "Book workdir", required: true as const },
    format: { type: "string" as const, description: "Output format (human|json)", required: false as const },
    embeddings: { type: "string" as const, description: "Embeddings provider (fake|local)", required: false as const },
  },
  async run({ args }) {
    const out = await runValidate(args.workdir as string, { embeddings: ((args.embeddings as string | undefined) ?? "local") as "fake" | "local" });
    if (args.format === "json" || process.stdout.isTTY === false) console.log(JSON.stringify(out));
    else console.log(`Valid: ${out.chapters} chapters${out.warnings.length > 0 ? `, ${out.warnings.length} advisory warning(s)` : ""}.`);
    return out;
  },
});
