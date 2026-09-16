import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "citty";
import ingest from "./ingest.js";
import init from "./init.js";

// Real PDFs (generated with PyMuPDF, checked in) pushed through the real unpdf
// extractor — the former "manual real-PDF test" is now an automated regression.
const fxDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "pdf");

describe("ingest on real PDF fixtures (unpdf)", () => {
  it("splits a classic book: roman-caps headings, running headers, TOC dot leaders, copyright junk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    await runCommand(init, { rawArgs: [join(fxDir, "classic-roman.pdf"), "--workdir", dir, "--locale", "en"] });
    const { result } = (await runCommand(ingest, { rawArgs: ["--workdir", dir, "--format", "json"] })) as any;
    expect(result.chapters).toBe(4);
    expect(result.markers).toEqual({ regex: 4, fallback: 0, heuristic: 0 });
    const raw = JSON.parse(readFileSync(join(dir, "raw_chapters.json"), "utf8"));
    expect(raw.map((c: any) => c.title)).toEqual(["CHAPTER I", "CHAPTER II", "CHAPTER III", "CHAPTER IV"]);
    for (let i = 1; i < raw.length; i++) expect(raw[i].char_start).toBe(raw[i - 1].char_end);
  });

  it("rescues a graphic-title book via the page-structure fallback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    await runCommand(init, { rawArgs: [join(fxDir, "graphic-titles.pdf"), "--workdir", dir, "--locale", "en"] });
    const { result } = (await runCommand(ingest, { rawArgs: ["--workdir", dir, "--format", "json"] })) as any;
    expect(result.chapters).toBe(2);
    expect(result.markers).toEqual({ regex: 0, fallback: 0, heuristic: 2 });
    const raw = JSON.parse(readFileSync(join(dir, "raw_chapters.json"), "utf8"));
    expect(raw.map((c: any) => c.marker_type)).toEqual(["heuristic", "heuristic"]);
    expect(raw[0].text.length).toBeGreaterThan(500);
    expect(raw[1].text.length).toBeGreaterThan(500);
  });
});
