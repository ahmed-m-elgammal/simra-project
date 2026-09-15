import { defineCommand } from "citty";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@app/bundle-builder";
import { readState, writeState } from "../lib/workdir.js";
import { assembleBook } from "../lib/assemble.js";
import { runValidate } from "./validate.js";

export default defineCommand({
  meta: { name: "build", description: "Validate green, then compile the deterministic bundle (local only)." },
  args: {
    workdir: { type: "string" as const, description: "Book workdir", required: true as const },
    format: { type: "string" as const, description: "Output format (human|json)", required: false as const },
    embeddings: { type: "string" as const, description: "Embeddings provider (fake|local)", required: false as const },
  },
  async run({ args }) {
    const workdir = args.workdir as string;
    await runValidate(workdir, { embeddings: ((args.embeddings as string | undefined) ?? "local") as "fake" | "local" });
    const book = assembleBook(workdir);
    const config = readState<{ book_id: string; locale: string; next_version: number }>(workdir, "bookforge.config.json");
    const out = compile({ ...book, config: { vars: book.config.vars, bands: book.config.bands } });
    const dist = join(workdir, "dist");
    mkdirSync(dist, { recursive: true });
    const base = `bundle-${book.book_id}-${config.locale}-v${book.version}`;
    writeFileSync(join(dist, `${base}.json`), out.json);
    writeFileSync(join(dist, `${base}.json.br`), out.br);
    writeFileSync(join(dist, `${base}.json.gz`), out.gz);
    writeState(workdir, "bookforge.config.json", { ...config, next_version: book.version + 1 });
    const report = { ok: true as const, sha: out.sha, bytes: out.json.length, wire_br: out.br.length, file: `dist/${base}.json` };
    if (args.format === "json" || process.stdout.isTTY === false) console.log(JSON.stringify(report));
    else console.log(`Built ${report.file} (${report.bytes}B, brotli ${report.wire_br}B, sha ${report.sha.slice(0, 12)}…).`);
    return report;
  },
});
