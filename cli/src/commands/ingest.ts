import { defineCommand } from "citty";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError, readState, writeState } from "../lib/workdir.js";
import { getExtractor } from "../lib/extract.js";
import { splitChapters } from "../lib/split.js";
import type { BookforgeConfig } from "./init.js";

export default defineCommand({
  meta: { name: "ingest", description: "Extract PDF text and split into raw chapters." },
  args: {
    workdir: { type: "string", description: "Book workdir", required: true },
    format: { type: "string", description: "Output format (human|json)", required: false },
  },
  async run({ args }) {
    const workdir = args.workdir as string;
    const config = readState<BookforgeConfig>(workdir, "bookforge.config.json");
    if (!existsSync(config.pdf_path)) {
      throw new CliError("MISSING_INPUT", `PDF not found: ${config.pdf_path}`);
    }
    const bytes = new Uint8Array(readFileSync(config.pdf_path));
    const { pages } = await getExtractor().extractText(bytes);
    const chapters = splitChapters(pages.join("\n"));
    writeState(workdir, "raw_chapters.json", chapters);
    writeFileSync(join(workdir, "raw_full.txt"), pages.join("\n"));
    const regex = chapters.filter((c) => c.marker_type === "regex").length;
    const result = { ok: true as const, chapters: chapters.length, markers: { regex, fallback: chapters.length - regex } };
    if (args.format === "json" || process.stdout.isTTY === false) {
      console.log(JSON.stringify(result));
    } else {
      console.log(`Ingested ${result.chapters} chapters (${regex} regex, ${result.markers.fallback} fallback markers).`);
    }
    return result;
  },
});
