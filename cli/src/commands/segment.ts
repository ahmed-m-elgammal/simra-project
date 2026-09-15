import { defineCommand } from "citty";
import { z } from "zod";
import { CliError, readState, writeState } from "../lib/workdir.js";
import { buildSegmentPack } from "../lib/packs.js";
import { submitJson, withRules, type Detail } from "../lib/submit.js";

const SimChaptersSchema = z.object({
  sim_chapters: z.array(
    z.object({
      order: z.number().int().positive(),
      title: z.string().min(1),
      source_ranges: z.array(z.string().min(1)).min(1),
      rationale: z.string(),
      teaching_point: z.string().min(1),
    }),
  ),
});

export function checkSegmentation(sim: { sim_chapters: Array<{ order: number; title: string; source_ranges: string[] }> }, rawIds: string[]): Detail[] {
  const errs: Array<{ code: string; message: string; nodeIds: string[] }> = [];
  const seen = new Map<string, number>();
  for (const s of sim.sim_chapters) {
    for (const r of s.source_ranges) seen.set(r, (seen.get(r) ?? 0) + 1);
  }
  for (const id of rawIds) {
    const n = seen.get(id) ?? 0;
    if (n !== 1) errs.push({ code: "SEGMENT_COVERAGE", message: `raw chapter covered ${n}x (need exactly 1): ${id}`, nodeIds: [id] });
  }
  for (const [id, n] of seen) {
    if (!rawIds.includes(id)) errs.push({ code: "SEGMENT_COVERAGE", message: `unknown source range: ${id} (used ${n}x)`, nodeIds: [id] });
  }
  const orders = sim.sim_chapters.map((s) => s.order).sort((a, b) => a - b);
  orders.forEach((o, i) => {
    if (o !== i + 1) errs.push({ code: "SEGMENT_ORDER", message: `orders must be unique and sequential from 1 (found ${o} at position ${i + 1})`, nodeIds: [] });
  });
  const titles = new Set<string>();
  for (const s of sim.sim_chapters) {
    if (titles.has(s.title)) errs.push({ code: "SEGMENT_ORDER", message: `duplicate sim title: ${s.title}`, nodeIds: [] });
    titles.add(s.title);
  }
  return withRules(errs);
}

const workdirArg = { workdir: { type: "string" as const, description: "Book workdir", required: true as const } };
const formatArg = { format: { type: "string" as const, description: "Output format (human|json)", required: false as const } };

function out(format: unknown, data: unknown, human: string): unknown {
  if (format === "json" || process.stdout.isTTY === false) console.log(JSON.stringify(data));
  else console.log(human);
  return data;
}

const prompt = defineCommand({
  meta: { name: "prompt", description: "Emit the segmentation prompt pack." },
  args: { ...workdirArg, ...formatArg },
  run({ args }) {
    const workdir = args.workdir as string;
    const raw = readState<Array<{ id: string; title: string; text: string }>>(workdir, "raw_chapters.json");
    const config = readState<{ book_id: string; locale: string }>(workdir, "bookforge.config.json");
    const pack = buildSegmentPack({ book_id: config.book_id, locale: config.locale, raw });
    return out(args.format, pack, `Segmentation pack ready (${raw.length} raw chapters).`);
  },
});

const submit = defineCommand({
  meta: { name: "submit", description: "Validate and store proposed sim chapters." },
  args: { ...workdirArg, ...formatArg, file: { type: "string" as const, description: "Agent output JSON file", required: true as const } },
  run({ args }) {
    const workdir = args.workdir as string;
    const data = submitJson(args.file as string, SimChaptersSchema);
    const raw = readState<Array<{ id: string }>>(workdir, "raw_chapters.json");
    const errs = checkSegmentation(data, raw.map((r) => r.id));
    if (errs.length > 0) throw new CliError("VALIDATION", `${errs.length} segmentation check(s) failed`, errs);
    writeState(workdir, "sim_chapters.json", data);
    return out(args.format, { ok: true, stored: "sim_chapters.json", warnings: [] }, "Segmentation stored. Review, then `segment approve`.");
  },
});

const approve = defineCommand({
  meta: { name: "approve", description: "Human gate: lock the segmentation." },
  args: { ...workdirArg, ...formatArg },
  run({ args }) {
    const workdir = args.workdir as string;
    const data = readState<{ sim_chapters: Array<{ order: number; title: string; source_ranges: string[] }> }>(workdir, "sim_chapters.json");
    const raw = readState<Array<{ id: string }>>(workdir, "raw_chapters.json");
    const errs = checkSegmentation(data, raw.map((r) => r.id));
    if (errs.length > 0) throw new CliError("VALIDATION", "cannot approve: proposed segmentation fails re-check", errs);
    writeState(workdir, "sim_chapters.approved.json", data);
    return out(args.format, { ok: true, approved: "sim_chapters.approved.json" }, "Segmentation locked.");
  },
});

const requestChanges = defineCommand({
  meta: { name: "request-changes", description: "Send back with a reviewer note." },
  args: { ...workdirArg, ...formatArg, note: { type: "string" as const, description: "Reviewer note", required: false as const } },
  async run({ args }) {
    let note = args.note as string | undefined;
    if (!note && process.stdin.isTTY === true) {
      const { text, isCancel } = await import("@clack/prompts");
      const v = await text({ message: "What must change in the segmentation?" });
      if (isCancel(v)) throw new CliError("ABORTED", "request-changes cancelled");
      note = String(v);
    }
    if (!note) throw new CliError("ABORTED", "non-interactive: request-changes requires --note");
    const { appendFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(join(args.workdir as string, "history"), { recursive: true });
    appendFileSync(join(args.workdir as string, "history", "segment.notes.jsonl"), JSON.stringify({ at: new Date().toISOString(), note }) + "\n");
    return out(args.format, { ok: true, recorded: "history/segment.notes.jsonl" }, "Note recorded. Re-run `segment prompt` for a new pack with history.");
  },
});

export default defineCommand({
  meta: { name: "segment", description: "Segmentation prompt/submit/approve." },
  subCommands: { prompt, submit, approve, "request-changes": requestChanges },
});

export { approve, prompt, requestChanges, submit };
