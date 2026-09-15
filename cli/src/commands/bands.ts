import { defineCommand } from "citty";
import { z } from "zod";
import { compileBand, RequiresSchema } from "@app/bundle-builder";
import { CliError, readState, writeState } from "../lib/workdir.js";
import { buildBandsPack } from "../lib/packs.js";
import { approvedChapters, buildLedger, submitJson, withRules } from "../lib/submit.js";

const BandsSchema = z.object({
  bands: z.array(z.object({ key: z.string().min(1), predicate: RequiresSchema })).min(1),
});

const workdirArg = { workdir: { type: "string" as const, description: "Book workdir", required: true as const } };
const formatArg = { format: { type: "string" as const, description: "Output format (human|json)", required: false as const } };

function out(format: unknown, data: unknown, human: string): unknown {
  if (format === "json" || process.stdout.isTTY === false) console.log(JSON.stringify(data));
  else console.log(human);
  return data;
}

function readPriorApproved(workdir: string): any[] {
  const files = approvedChapters(workdir);
  const chapters = files.map((f) => readState<any>(workdir, `chapters/${f}`));
  chapters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return chapters;
}

const prompt = defineCommand({
  meta: { name: "prompt", description: "Emit the bands prompt pack (needs all chapters approved)." },
  args: { ...workdirArg, ...formatArg },
  run({ args }) {
    const workdir = args.workdir as string;
    const sim = readState<{ sim_chapters: Array<{ order: number }> }>(workdir, "sim_chapters.approved.json");
    const prior = readPriorApproved(workdir);
    if (prior.length !== sim.sim_chapters.length) {
      throw new CliError("GATE_OPEN", `bands need all chapters approved (${prior.length}/${sim.sim_chapters.length} ready)`);
    }
    const config = readState<{ book_id: string; locale: string }>(workdir, "bookforge.config.json");
    const pack = buildBandsPack({ book_id: config.book_id, locale: config.locale, prior, ledger: buildLedger(workdir) });
    return out(args.format, pack, `Bands pack ready (${Object.keys(buildLedger(workdir)).length} variables).`);
  },
});

const submit = defineCommand({
  meta: { name: "submit", description: "Validate and store evaluation bands." },
  args: { ...workdirArg, ...formatArg, file: { type: "string" as const, description: "Agent output JSON file", required: true as const } },
  run({ args }) {
    const workdir = args.workdir as string;
    const data = submitJson(args.file as string, BandsSchema);
    const keys = Object.keys(buildLedger(workdir));
    for (const b of data.bands) {
      try {
        compileBand(b.predicate, keys);
      } catch (e: any) {
        throw new CliError("VALIDATION", `band predicate failed to compile: ${b.key}`, withRules([{ code: "UNKNOWN_VAR", message: e?.message ?? String(e), nodeIds: [b.key] }]));
      }
    }
    writeState(workdir, "bands.json", data);
    return out(args.format, { ok: true, stored: "bands.json", bands: data.bands.length }, `${data.bands.length} bands stored.`);
  },
});

export default defineCommand({
  meta: { name: "bands", description: "Bands prompt/submit." },
  subCommands: { prompt, submit },
});
