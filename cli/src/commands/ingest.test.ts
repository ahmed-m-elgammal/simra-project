import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import ingest from "./ingest.js";
import init from "./init.js";
import { StubExtractor, setExtractor } from "../lib/extract.js";

const PAGES = ["FOREWORD\nblah", "CHAPTER 1\nIntro text here.", "CHAPTER 2\nMore text.\nCHAPTER 3\nEnd."];

describe("ingest", () => {
  it("extracts and splits chapters, writes state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    const pdf = join(dir, "mybook.pdf");
    writeFileSync(pdf, "dummy-bytes");
    setExtractor(new StubExtractor(PAGES));
    try {
      await runCommand(init, { rawArgs: [pdf, "--workdir", dir, "--locale", "en"] });
      const { result: res } = (await runCommand(ingest, { rawArgs: ["--workdir", dir] })) as any;
      expect(res.chapters).toBe(4);
      const raw = JSON.parse(readFileSync(join(dir, "raw_chapters.json"), "utf8"));
      expect(raw.map((c: any) => c.title)).toEqual(["FOREWORD", "CHAPTER 1", "CHAPTER 2", "CHAPTER 3"]);
    } finally {
      setExtractor(undefined);
    }
  });
  it("rejects unsupported locales at init", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    await expect(runCommand(init, { rawArgs: ["b.pdf", "--workdir", dir, "--locale", "de"] })).rejects.toThrow(/locale/);
  });
});
