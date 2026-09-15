import { defineCommand } from "citty";
import { CanonicalChapterSchema } from "@app/bundle-builder";
import { CliError, readState, writeState } from "../lib/workdir.js";
import { buildChapterPack } from "../lib/packs.js";
import { approvedChapters, buildLedger, submitChapterData, submitJson } from "../lib/submit.js";

const workdirArg = { workdir: { type: "string" as const, description: "Book workdir", required: true as const } };
const formatArg = { format: { type: "string" as const, description: "Output format (human|json)", required: false as const } };
const nArg = { n: { type: "string" as const, description: "Sim chapter order number", required: true as const } };

function out(format: unknown, data: unknown, human: string): unknown {
  if (format === "json" || process.stdout.isTTY === false) console.log(JSON.stringify(data));
  else console.log(human);
  return data;
}

function fileFor(order: number): string {
  return `chapters/${String(order).padStart(2, "0")}.json`;
}

const prompt = defineCommand({
  meta: { name: "prompt", description: "Emit a chapter prompt pack (needs approved segmentation + personas)." },
  args: { ...workdirArg, ...formatArg, ...nArg },
  run({ args }) {
    const workdir = args.workdir as string;
    const order = Number(args.n);
    if (!Number.isInteger(order) || order < 1) throw new CliError("VALIDATION", `--n must be a positive integer (got ${args.n})`);
    const raw = readState<Array<{ id: string; title: string; text: string }>>(workdir, "raw_chapters.json");
    const sim = readState<{ sim_chapters: Array<{ order: number; title: string; source_ranges: string[]; rationale: string; teaching_point: string }> }>(workdir, "sim_chapters.approved.json");
    const personas = readState<{ teaching_goal: string; personas: unknown[] }>(workdir, "personas.json");
    const config = readState<{ book_id: string; locale: string }>(workdir, "bookforge.config.json");
    const prior = approvedChapters(workdir)
      .map((f) => readState<any>(workdir, `chapters/${f}`))
      .filter((c) => (c.order ?? 0) < order)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const pack = buildChapterPack({
      book_id: config.book_id,
      locale: config.locale,
      chapterOrder: order,
      raw,
      sim,
      personas,
      prior,
      ledger: buildLedger(workdir),
    });
    return out(args.format, pack, `Chapter ${order} pack ready (${prior.length} prior approved).`);
  },
});

const submit = defineCommand({
  meta: { name: "submit", description: "Validate and store a chapter." },
  args: { ...workdirArg, ...formatArg, ...nArg, file: { type: "string" as const, description: "Agent output JSON file", required: true as const } },
  run({ args }) {
    const workdir = args.workdir as string;
    const order = Number(args.n);
    if (!Number.isInteger(order) || order < 1) throw new CliError("VALIDATION", `--n must be a positive integer (got ${args.n})`);
    const data = submitJson(args.file as string, CanonicalChapterSchema);
    if (data.order !== order) {
      throw new CliError("VALIDATION", `submitted order ${data.order} does not match --n ${order}`);
    }
    const { warnings } = submitChapterData(workdir, data);
    const stored = fileFor(order);
    writeState(workdir, stored, data);
    return out(args.format, { ok: true, stored, warnings }, `Chapter ${order} stored${warnings.length > 0 ? ` (${warnings.length} advisory warning(s))` : ""}. Review, then approve.`);
  },
});

const approve = defineCommand({
  meta: { name: "approve", description: "Human gate: lock a chapter." },
  args: { ...workdirArg, ...formatArg, ...nArg },
  run({ args }) {
    const workdir = args.workdir as string;
    const order = Number(args.n);
    const data = readState<any>(workdir, fileFor(order));
    submitChapterData(workdir, data);
    const approved = fileFor(order).replace(".json", ".approved.json");
    writeState(workdir, approved, data);
    return out(args.format, { ok: true, approved }, `Chapter ${order} locked.`);
  },
});

const requestChanges = defineCommand({
  meta: { name: "request-changes", description: "Send a chapter back with a reviewer note." },
  args: { ...workdirArg, ...formatArg, ...nArg, note: { type: "string" as const, description: "Reviewer note", required: false as const } },
  async run({ args }) {
    let note = args.note as string | undefined;
    if (!note && process.stdin.isTTY === true) {
      const { text, isCancel } = await import("@clack/prompts");
      const v = await text({ message: `What must change in chapter ${args.n}?` });
      if (isCancel(v)) throw new CliError("ABORTED", "request-changes cancelled");
      note = String(v);
    }
    if (!note) throw new CliError("ABORTED", "non-interactive: request-changes requires --note");
    const { appendFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(join(args.workdir as string, "history"), { recursive: true });
    appendFileSync(
      join(args.workdir as string, "history", `${String(args.n).padStart(2, "0")}.notes.jsonl`),
      JSON.stringify({ at: new Date().toISOString(), note }) + "\n",
    );
    return out(args.format, { ok: true, recorded: true }, "Note recorded. Re-run `chapter prompt` for a new pack with history.");
  },
});

export default defineCommand({
  meta: { name: "chapter", description: "Chapter prompt/submit/approve." },
  subCommands: { prompt, submit, approve, "request-changes": requestChanges },
});

export { approve, prompt, requestChanges, submit };
