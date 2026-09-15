import { defineCommand } from "citty";
import { z } from "zod";
import { readState, writeState } from "../lib/workdir.js";
import { buildPersonasPack } from "../lib/packs.js";
import { submitJson } from "../lib/submit.js";

const PersonasSchema = z.object({
  teaching_goal: z.string().min(1),
  personas: z
    .array(
      z.object({
        persona_id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        starting_state: z.record(z.string(), z.number()),
      }),
    )
    .min(1),
});

const workdirArg = { workdir: { type: "string" as const, description: "Book workdir", required: true as const } };
const formatArg = { format: { type: "string" as const, description: "Output format (human|json)", required: false as const } };

function out(format: unknown, data: unknown, human: string): unknown {
  if (format === "json" || process.stdout.isTTY === false) console.log(JSON.stringify(data));
  else console.log(human);
  return data;
}

const prompt = defineCommand({
  meta: { name: "prompt", description: "Emit the personas prompt pack (needs approved segmentation)." },
  args: { ...workdirArg, ...formatArg },
  run({ args }) {
    const workdir = args.workdir as string;
    const raw = readState<Array<{ id: string; title: string; text: string }>>(workdir, "raw_chapters.json");
    const sim = readState<{ sim_chapters: Array<{ order: number; title: string; source_ranges: string[]; rationale: string; teaching_point: string }> }>(workdir, "sim_chapters.approved.json");
    const config = readState<{ book_id: string; locale: string }>(workdir, "bookforge.config.json");
    const pack = buildPersonasPack({ book_id: config.book_id, locale: config.locale, raw, sim });
    return out(args.format, pack, `Personas pack ready (${sim.sim_chapters.length} sim chapters).`);
  },
});

const submit = defineCommand({
  meta: { name: "submit", description: "Validate and store the persona set." },
  args: { ...workdirArg, ...formatArg, file: { type: "string" as const, description: "Agent output JSON file", required: true as const } },
  run({ args }) {
    const workdir = args.workdir as string;
    const data = submitJson(args.file as string, PersonasSchema);
    writeState(workdir, "personas.json", data);
    return out(args.format, { ok: true, stored: "personas.json", personas: data.personas.length }, `${data.personas.length} personas stored.`);
  },
});

export default defineCommand({
  meta: { name: "personas", description: "Personas prompt/submit." },
  subCommands: { prompt, submit },
});

export { prompt, submit };
