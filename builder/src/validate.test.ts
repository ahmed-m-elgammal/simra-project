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
  it("flags duplicate option ids instead of overwriting them", () => {
    const errs = validateChapter(load("invalid-dup-id.json"), ["maya", "omar"], ledger);
    expect(errs.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });

  const OK_TEXT =
    "Maya laces her shoes before doubt can finish its sentence and steps into the gray morning. The first ten minutes feel stiff, then her stride loosens and the day's noise drops away. By the time she turns for home, Consistency has climbed to {x} and the cold air has lifted everything higher.";
  const mkChapter = (decisions: any) => ({
    chapter_id: "t",
    order: 0,
    sourcing: { mode: "invent", quote: "" },
    new_variables: [],
    decisions,
    recap_hints: [],
  });
  const mkOption = (id: string, effects: any, requires: unknown = null) => ({
    id,
    label: "L",
    intent: "I",
    next: "chapter_end",
    requires,
    lock_reason: "R",
    persona_effects: effects,
  });
  const E = (pid: string, delta: any, text: string = OK_TEXT) => ({ persona_id: pid, delta, outcome_text: text });
  const ledgerX = { x: { introduced_in: 1 } };

  it("flags an option missing one persona", () => {
    const ch = mkChapter([{ id: "d", options: [mkOption("o", [E("maya", { x: 1 })])] }]);
    const errs = validateChapter(ch, ["maya", "omar"], ledgerX);
    expect(errs.some((e) => e.code === "MISSING_PERSONA")).toBe(true);
    expect(errs.some((e) => e.code === "WORD_COUNT")).toBe(false);
  });
  it("flags unknown placeholder vars without flagging them as delta vars", () => {
    const ch = mkChapter([{ id: "d", options: [mkOption("o", [E("maya", { x: 1 }, OK_TEXT.replace("{x}", "{ghost}"))])] }]);
    const errs = validateChapter(ch, ["maya"], ledgerX);
    expect(errs.some((e) => e.code === "BAD_PLACEHOLDER")).toBe(true);
    expect(errs.some((e) => e.code === "UNKNOWN_VAR")).toBe(false);
  });
  it("flags unknown vars inside requires predicates", () => {
    const ch = mkChapter([
      { id: "d", options: [mkOption("o", [E("maya", { x: 1 })], { all: [{ var: "nope", op: ">=", value: 1 }] })] },
    ]);
    expect(validateChapter(ch, ["maya"], ledgerX).some((e) => e.code === "UNKNOWN_VAR")).toBe(true);
  });
  it("flags outcome_text above 100 words", () => {
    const ch = mkChapter([{ id: "d", options: [mkOption("o", [E("maya", { x: 1 }, "word ".repeat(110).trim())])] }]);
    expect(validateChapter(ch, ["maya"], ledgerX).some((e) => e.code === "WORD_COUNT")).toBe(true);
  });
  it("stays clean when a gated option references known vars", () => {
    const ch = mkChapter([
      {
        id: "d",
        options: [
          mkOption("open", [E("maya", { x: 1 })]),
          mkOption("gated", [E("maya", { x: 2 })], { all: [{ var: "x", op: ">=", value: 1 }] }),
        ],
      },
    ]);
    expect(validateChapter(ch, ["maya"], ledgerX)).toEqual([]);
  });
});
