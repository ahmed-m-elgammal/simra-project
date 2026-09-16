import { describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "citty";
import { CliError } from "../lib/workdir.js";
import { runValidate } from "./validate.js";
import build from "./build.js";

const fxDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "minibook");

function seedFullWorkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bf-"));
  writeFileSync(join(dir, "bookforge.config.json"), JSON.stringify({ book_id: "mini", locale: "en", thresholds: { dupFlag: 0.85, dupNote: 0.7 }, pack_format: 1, next_version: 1 }));
  for (const f of ["raw_chapters.json", "sim_chapters.json", "personas.json", "bands.json"]) {
    copyFileSync(join(fxDir, f), join(dir, f));
  }
  copyFileSync(join(fxDir, "sim_chapters.json"), join(dir, "sim_chapters.approved.json"));
  mkdirSync(join(dir, "chapters"), { recursive: true });
  copyFileSync(join(fxDir, "chapters", "01.json"), join(dir, "chapters", "01.approved.json"));
  copyFileSync(join(fxDir, "agent-chapter02-good.json"), join(dir, "chapters", "02.approved.json"));
  return dir;
}

function seedLongWorkdir(count: number): string {
  const dir = seedFullWorkdir();
  const raw = Array.from({ length: count }, (_, index) => ({ id: `raw_ch_${index + 1}`, title: `Chapter ${index + 1}`, text: `Chapter ${index + 1}` }));
  const sim = { sim_chapters: raw.map((chapter, index) => ({ order: index + 1, title: chapter.title, source_ranges: [chapter.id], rationale: "fixture", teaching_point: `Point ${index + 1}` })) };
  writeFileSync(join(dir, "raw_chapters.json"), JSON.stringify(raw));
  writeFileSync(join(dir, "sim_chapters.json"), JSON.stringify(sim));
  writeFileSync(join(dir, "sim_chapters.approved.json"), JSON.stringify(sim));
  const template = JSON.parse(readFileSync(join(dir, "chapters", "02.approved.json"), "utf8"));
  for (let order = 3; order <= count; order += 1) {
    const chapter = JSON.parse(JSON.stringify(template));
    chapter.chapter_id = `mini_ch${order}`;
    chapter.order = order;
    for (const decision of chapter.decisions) {
      decision.id = `mdec${order}_${decision.id}`;
      for (const option of decision.options) option.id = `mopt${order}_${option.id}`;
    }
    writeFileSync(join(dir, "chapters", `${String(order).padStart(2, "0")}.approved.json`), JSON.stringify(chapter));
  }
  return dir;
}

describe("validate + build", () => {
  it("validates a complete approved workdir", async () => {
    const out = await runValidate(seedFullWorkdir(), { embeddings: "fake" });
    expect(out.ok).toBe(true);
    expect(out.chapters).toBe(2);
  });
  it("builds the bundle and matches the golden hash", async () => {
    const dir = seedFullWorkdir();
    const { result } = (await runCommand(build, { rawArgs: ["--workdir", dir, "--embeddings", "fake"] })) as any;
    expect(result.ok).toBe(true);
    expect(result.sha).toMatch(/^[0-9a-f]{64}$/);
    const golden = readFileSync(join(fxDir, "bundle.golden.hash"), "utf8").trim();
    expect(result.sha).toBe(golden);
    expect(existsSync(join(dir, "dist", "bundle-mini-en-v1.json"))).toBe(true);
    expect(existsSync(join(dir, "dist", "bundle-mini-en-v1.json.br"))).toBe(true);
    const config = JSON.parse(readFileSync(join(dir, "bookforge.config.json"), "utf8"));
    expect(config.next_version).toBe(2);
  });
  it("builds with secrets scrubbed from env (local-only proof)", async () => {
    const saved = { ...process.env };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.HTTPS_PROXY;
    try {
      const dir = seedFullWorkdir();
      const { result } = (await runCommand(build, { rawArgs: ["--workdir", dir, "--embeddings", "fake"] })) as any;
      expect(result.ok).toBe(true);
    } finally {
      process.env = saved;
    }
  });
  it("validates and builds a book with chapters beyond two digits", async () => {
    const dir = seedLongWorkdir(100);
    const validation = await runValidate(dir, { embeddings: "fake" });
    expect(validation.chapters).toBe(100);
    const { result } = (await runCommand(build, { rawArgs: ["--workdir", dir, "--embeddings", "fake"] })) as any;
    expect(result.ok).toBe(true);
    expect(existsSync(join(dir, "dist", "bundle-mini-en-v1.json"))).toBe(true);
  }, 15000);
  it("validate fails when an approved chapter breaks", async () => {
    const dir = seedFullWorkdir();
    const bad = JSON.parse(readFileSync(join(dir, "chapters", "02.approved.json"), "utf8"));
    bad.decisions[0].options[0].next = "nowhere";
    writeFileSync(join(dir, "chapters", "02.approved.json"), JSON.stringify(bad));
    await expect(runValidate(dir, { embeddings: "fake" })).rejects.toBeInstanceOf(CliError);
  });
});
