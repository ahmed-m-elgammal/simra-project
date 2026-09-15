import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateChapter } from "./index.js";

const dir = dirname(fileURLToPath(import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(join(dir, "..", "fixtures", n), "utf8"));
const ledger = { consistency: { introduced_in: 1 }, energy: { introduced_in: 1 } };

describe("validateChapter", () => {
  it("accepts the good fixture", () => {
    expect(validateChapter(load("habits-ch1.canonical.json"), ["maya", "omar"], ledger)).toEqual([]);
  });
  it("flags a next-graph cycle with node ids", () => {
    const errs = validateChapter(load("invalid-cycle.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "DAG_CYCLE")).toBe(true);
  });
  it("flags delta keys outside the ledger", () => {
    const errs = validateChapter(load("invalid-unknown-var.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "UNKNOWN_VAR")).toBe(true);
  });
  it("flags a decision with no always-available option", () => {
    const errs = validateChapter(load("invalid-all-locked.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "NO_OPEN_OPTION")).toBe(true);
  });
  it("flags outcome_text outside 30-100 words (spec: 40-70, validator tolerates 30-100)", () => {
    const errs = validateChapter(load("invalid-word-count.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "WORD_COUNT")).toBe(true);
  });
});
