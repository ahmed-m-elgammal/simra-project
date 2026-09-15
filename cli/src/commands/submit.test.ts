import { describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "citty";
import { CliError } from "../lib/workdir.js";
import { approve as chapterApprove, requestChanges as chapterRequestChanges, submit as chapterSubmit } from "./chapter.js";
import { submit as segmentSubmit } from "./segment.js";

const fxDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "minibook");
const fx = (n: string) => join(fxDir, n);

function seedWorkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bf-"));
  const cp = (src: string, dest: string) => {
    const target = join(dir, dest);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(fxDir, src), target);
  };
  writeFileSync(join(dir, "bookforge.config.json"), JSON.stringify({ book_id: "mini", locale: "en", thresholds: { dupFlag: 0.85, dupNote: 0.7 }, pack_format: 1, next_version: 1 }));
  cp("personas.json", "personas.json");
  cp("sim_chapters.json", "sim_chapters.approved.json");
  cp("chapters/01.json", "chapters/01.approved.json");
  return dir;
}

describe("submit + approve", () => {
  it("stores a valid chapter and reports warnings array", async () => {
    const dir = seedWorkdir();
    const { result } = (await runCommand(chapterSubmit, { rawArgs: ["--workdir", dir, "--n", "2", "--file", fx("agent-chapter02-good.json")] })) as any;
    expect(result.ok).toBe(true);
    expect(result.stored).toBe("chapters/02.json");
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(existsSync(join(dir, "chapters", "02.json"))).toBe(true);
  });
  it("rejects a chapter missing a persona with machine-readable details", async () => {
    const dir = seedWorkdir();
    try {
      await runCommand(chapterSubmit, { rawArgs: ["--workdir", dir, "--n", "2", "--file", fx("agent-chapter02-bad.json")] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("VALIDATION");
      const details = (e as CliError).details as Array<{ code: string; rule: string }>;
      expect(details.some((d) => d.code === "MISSING_PERSONA")).toBe(true);
      expect(details.every((d) => typeof d.rule === "string" && d.rule.length > 0)).toBe(true);
    }
    expect(existsSync(join(dir, "chapters", "02.json"))).toBe(false);
  });
  it("approve locks a stored chapter; approve without proposed fails", async () => {
    const dir = seedWorkdir();
    await runCommand(chapterSubmit, { rawArgs: ["--workdir", dir, "--n", "2", "--file", fx("agent-chapter02-good.json")] });
    const { result } = (await runCommand(chapterApprove, { rawArgs: ["--workdir", dir, "--n", "2"] })) as any;
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "chapters", "02.approved.json"), "utf8")).chapter_id).toBe("mini_ch2");
    const dir2 = seedWorkdir();
    await expect(runCommand(chapterApprove, { rawArgs: ["--workdir", dir2, "--n", "9"] })).rejects.toBeInstanceOf(CliError);
  });
  it("request-changes records the note", async () => {
    const dir = seedWorkdir();
    const { result } = (await runCommand(chapterRequestChanges, {
      rawArgs: ["--workdir", dir, "--n", "2", "--note", "outcome too rosy"],
    })) as any;
    expect(result.ok).toBe(true);
    const notes = readFileSync(join(dir, "history", "02.notes.jsonl"), "utf8");
    expect(notes).toContain("outcome too rosy");
  });
  it("segment submit enforces raw coverage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    writeFileSync(join(dir, "bookforge.config.json"), JSON.stringify({ book_id: "mini", locale: "en" }));
    writeFileSync(join(dir, "raw_chapters.json"), JSON.stringify([{ id: "raw_ch_1" }, { id: "raw_ch_2" }]));
    const bad = join(dir, "seg.json");
    writeFileSync(bad, JSON.stringify({ sim_chapters: [{ order: 1, title: "All", source_ranges: ["raw_ch_1"], rationale: "r", teaching_point: "t" }] }));
    try {
      await runCommand(segmentSubmit, { rawArgs: ["--workdir", dir, "--file", bad] });
      expect.unreachable();
    } catch (e) {
      expect(((e as CliError).details as Array<{ code: string }>).some((d) => d.code === "SEGMENT_COVERAGE")).toBe(true);
    }
  });
});
