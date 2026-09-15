import { describe, expect, it } from "vitest";
import { validateChapter } from "./index.js";
import { compile } from "./index.js";
import { mulberry32 } from "./bands.js";

function randomChapter(rand: () => number, personas: string[]): any {
  const nDec = 1 + Math.floor(rand() * 2);
  const decisions = [];
  for (let d = 0; d < nDec; d++) {
    const nOpt = 2 + Math.floor(rand() * 2);
    const options = [];
    for (let o = 0; o < nOpt; o++) {
      const words = (n: number): string => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
      options.push({
        id: `d${d}o${o}`,
        label: `opt ${o}`,
        intent: `intent ${o} with enough words to read naturally here today`,
        next: d + 1 < nDec ? `d${d + 1}` : "chapter_end",
        requires: o === 0 ? null : { all: [{ var: "x", op: ">=", value: 1 }] },
        lock_reason: "Needs x at 1 or more for this demanding option here today.",
        persona_effects: personas.map((p) => ({
          persona_id: p,
          delta: { x: Math.floor(rand() * 5) - 2 },
          outcome_text: `Outcome for ${p} choice ${o}: ${words(35)} reaches {x} in the end.`,
        })),
      });
    }
    decisions.push({ id: `d${d}`, prompt: `prompt ${d} with enough words to pass schema validation here`, options });
  }
  return {
    chapter_id: "fuzz",
    order: 0,
    sourcing: { mode: "invent", quote: "" },
    new_variables: [],
    decisions,
    recap_hints: [],
  };
}

describe("fuzz", () => {
  it("never throws and valid chapters compile", () => {
    for (const seed of [7, 99, 1234]) {
      const rand = mulberry32(seed);
      for (let i = 0; i < 50; i++) {
      const ch = randomChapter(rand, ["p1", "p2"]);
      const errs = validateChapter(ch, ["p1", "p2"], { x: { introduced_in: 1 } });
      expect(Array.isArray(errs)).toBe(true);
      if (errs.length === 0) {
        const out = compile({
          book_id: "f",
          version: 1,
          config: { vars: [], bands: [] },
          personas: [{ persona_id: "p1" }, { persona_id: "p2" }],
          chapters: [ch],
        });
        expect(out.sha).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    }
  });
});
