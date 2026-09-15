import { defineCommand } from "citty";
import { basename, resolve } from "node:path";
import { CliError, writeState } from "../lib/workdir.js";

const LOCALES = ["en", "ar"] as const;

export interface BookforgeConfig {
  book_id: string;
  pdf_path: string;
  locale: (typeof LOCALES)[number];
  thresholds: { dupFlag: number; dupNote: number };
  pack_format: 1;
  next_version: number;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export default defineCommand({
  meta: { name: "init", description: "Scaffold a book workdir from a PDF path." },
  args: {
    pdf: { type: "positional", description: "Path to the book PDF", required: true },
    workdir: { type: "string", description: "Workdir to create", required: true },
    locale: { type: "string", description: "Content locale (en|ar)", required: true },
  },
  run({ args }) {
    if (!(LOCALES as readonly string[]).includes(args.locale)) {
      throw new CliError("VALIDATION", `unsupported locale: ${args.locale} (expected en|ar)`);
    }
    const pdfPath = resolve(args.pdf as string);
    const config: BookforgeConfig = {
      book_id: slugify(basename(pdfPath)),
      pdf_path: pdfPath,
      locale: args.locale as (typeof LOCALES)[number],
      thresholds: { dupFlag: 0.85, dupNote: 0.7 },
      pack_format: 1,
      next_version: 1,
    };
    writeState(args.workdir as string, "bookforge.config.json", config);
    return { ok: true, book_id: config.book_id, workdir: args.workdir };
  },
});
