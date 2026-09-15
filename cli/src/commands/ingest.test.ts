import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "citty";
import { CliError } from "../lib/workdir.js";
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
  it("slugifies the book id and writes config defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    const pdf = join(dir, "My Great Book (Final).pdf");
    writeFileSync(pdf, "x");
    const { result } = (await runCommand(init, { rawArgs: [pdf, "--workdir", dir, "--locale", "ar"] })) as any;
    expect(result.book_id).toBe("my-great-book-final");
    const config = JSON.parse(readFileSync(join(dir, "bookforge.config.json"), "utf8"));
    expect(config.locale).toBe("ar");
    expect(config.next_version).toBe(1);
    expect(config.pack_format).toBe(1);
    expect(config.thresholds).toEqual({ dupFlag: 0.85, dupNote: 0.7 });
  });
  it("ingest fails cleanly without init", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    try {
      await runCommand(ingest, { rawArgs: ["--workdir", dir] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("MISSING_INPUT");
    }
  });
  it("ingest fails cleanly when the PDF is gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    const pdf = join(dir, "gone.pdf");
    writeFileSync(pdf, "x");
    await runCommand(init, { rawArgs: [pdf, "--workdir", dir, "--locale", "en"] });
    const { rmSync } = await import("node:fs");
    rmSync(pdf);
    setExtractor(new StubExtractor(PAGES));
    try {
      await expect(runCommand(ingest, { rawArgs: ["--workdir", dir] })).rejects.toThrow(/PDF not found/);
    } finally {
      setExtractor(undefined);
    }
  });
  it("writes raw_full.txt alongside chapters", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    const pdf = join(dir, "b.pdf");
    writeFileSync(pdf, "x");
    setExtractor(new StubExtractor(PAGES));
    try {
      await runCommand(init, { rawArgs: [pdf, "--workdir", dir, "--locale", "en"] });
      await runCommand(ingest, { rawArgs: ["--workdir", dir] });
      expect(readFileSync(join(dir, "raw_full.txt"), "utf8")).toContain("CHAPTER 1");
    } finally {
      setExtractor(undefined);
    }
  });
});
