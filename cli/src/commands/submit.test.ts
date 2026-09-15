import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "citty";
import { CliError } from "../lib/workdir.js";
import { approve as chapterApprove, requestChanges as chapterRequestChanges, submit as chapterSubmit } from "./chapter.js";
import { prompt as chapterPrompt } from "./chapter.js";
import { approve as segmentApprove, submit as segmentSubmit } from "./segment.js";
import { prompt as personasPrompt, submit as personasSubmit } from "./personas.js";
import { prompt as bandsPrompt, submit as bandsSubmit } from "./bands.js";
import { seedFullWorkdir } from "../../fixtures/minibook/seed-workdir.js";

const fxDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "minibook");
const fx = (n: string) => join(fxDir, n);
const seedWorkdir = seedFullWorkdir;

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
    expect(existsSync(join(dir, "sim_chapters.json"))).toBe(false);
  });
  it("segment approve locks; re-approve after tampering fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    writeFileSync(join(dir, "bookforge.config.json"), JSON.stringify({ book_id: "mini", locale: "en" }));
    writeFileSync(join(dir, "raw_chapters.json"), JSON.stringify([{ id: "raw_ch_1" }]));
    const good = join(dir, "seg.json");
    writeFileSync(good, JSON.stringify({ sim_chapters: [{ order: 1, title: "All", source_ranges: ["raw_ch_1"], rationale: "r", teaching_point: "t" }] }));
    await runCommand(segmentSubmit, { rawArgs: ["--workdir", dir, "--file", good] });
    const { result } = (await runCommand(segmentApprove, { rawArgs: ["--workdir", dir] })) as any;
    expect(result.approved).toBe("sim_chapters.approved.json");
    writeFileSync(join(dir, "sim_chapters.json"), JSON.stringify({ sim_chapters: [{ order: 1, title: "All", source_ranges: ["nope"], rationale: "r", teaching_point: "t" }] }));
    await expect(runCommand(segmentApprove, { rawArgs: ["--workdir", dir] })).rejects.toBeInstanceOf(CliError);
  });
  it("personas prompt needs approved segmentation; submit stores the set", async () => {
    const dir = seedWorkdir();
    const { result } = (await runCommand(personasPrompt, { rawArgs: ["--workdir", dir] })) as any;
    expect(result.stage).toBe("personas");
    const dir2 = mkdtempSync(join(tmpdir(), "bf-"));
    writeFileSync(join(dir2, "bookforge.config.json"), JSON.stringify({ book_id: "mini", locale: "en" }));
    writeFileSync(join(dir2, "raw_chapters.json"), JSON.stringify([]));
    await expect(runCommand(personasPrompt, { rawArgs: ["--workdir", dir2] })).rejects.toBeInstanceOf(CliError);
    const file = join(dir, "personas-out.json");
    writeFileSync(file, JSON.stringify({ teaching_goal: "g", personas: [{ persona_id: "z", name: "Z", description: "D", starting_state: { x: 1 } }] }));
    const stored = (await runCommand(personasSubmit, { rawArgs: ["--workdir", dir, "--file", file] })) as any;
    expect(stored.result.personas).toBe(1);
  });
  it("chapter prompt carries the right order; submit rejects order mismatch", async () => {
    const dir = seedWorkdir();
    const { result } = (await runCommand(chapterPrompt, { rawArgs: ["--workdir", dir, "--n", "2"] })) as any;
    expect(result.chapter?.order).toBe(2);
    try {
      await runCommand(chapterSubmit, { rawArgs: ["--workdir", dir, "--n", "3", "--file", fx("agent-chapter02-good.json")] });
      expect.unreachable();
    } catch (e) {
      expect((e as CliError).code).toBe("VALIDATION");
    }
    expect(existsSync(join(dir, "chapters", "03.json"))).toBe(false);
  });
  it("approve revalidates: tampered proposed chapters do not lock", async () => {
    const dir = seedWorkdir();
    await runCommand(chapterSubmit, { rawArgs: ["--workdir", dir, "--n", "2", "--file", fx("agent-chapter02-good.json")] });
    const tampered = JSON.parse(readFileSync(join(dir, "chapters", "02.json"), "utf8"));
    tampered.decisions[0].options[0].next = "void";
    writeFileSync(join(dir, "chapters", "02.json"), JSON.stringify(tampered));
    await expect(runCommand(chapterApprove, { rawArgs: ["--workdir", dir, "--n", "2"] })).rejects.toBeInstanceOf(CliError);
    // seed ships 02.approved.json: prove approve did NOT overwrite it with tampered content.
    expect(readFileSync(join(dir, "chapters", "02.approved.json"), "utf8")).not.toContain("void");
  });
  it("bands prompt gates on all-approved; submit stores compiled-checked bands", async () => {
    const dir = seedFullWorkdir();
    const { result } = (await runCommand(bandsPrompt, { rawArgs: ["--workdir", dir] })) as any;
    expect(result.stage).toBe("bands");
    const file = join(dir, "bands-out.json");
    writeFileSync(file, JSON.stringify({ bands: [{ key: "k", predicate: { all: [{ var: "consistency", op: ">=", value: 1 }] } }] }));
    const stored = (await runCommand(bandsSubmit, { rawArgs: ["--workdir", dir, "--file", file] })) as any;
    expect(stored.result.bands).toBe(1);
    writeFileSync(file, JSON.stringify({ bands: [{ key: "k", predicate: { all: [{ var: "ghost", op: ">=", value: 1 }] } }] }));
    await expect(runCommand(bandsSubmit, { rawArgs: ["--workdir", dir, "--file", file] })).rejects.toBeInstanceOf(CliError);
    const dir2 = seedFullWorkdir();
    rmSync(join(dir2, "chapters", "02.approved.json"));
    try {
      await runCommand(bandsPrompt, { rawArgs: ["--workdir", dir2] });
      expect.unreachable();
    } catch (e) {
      expect((e as CliError).code).toBe("GATE_OPEN");
    }
  });
});
