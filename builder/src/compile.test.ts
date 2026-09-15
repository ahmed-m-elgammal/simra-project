import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { compile } from "./index.js";

const dir = dirname(fileURLToPath(import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(join(dir, "..", "fixtures", n), "utf8"));

describe("compile", () => {
  it("is byte-identical to the golden hash", () => {
    const ch = load("habits-ch1.canonical.json");
    const book = {
      book_id: "habits",
      version: 1,
      config: { vars: [{ key: "consistency" }, { key: "energy" }], bands: [] },
      personas: [{ persona_id: "maya" }, { persona_id: "omar" }],
      chapters: [ch],
    };
    const out = compile(book);
    const hash = createHash("sha256").update(out.json).digest("hex");
    const golden = readFileSync(join(dir, "..", "fixtures", "habits-ch1.bundle.hash"), "utf8").trim();
    expect(hash).toBe(golden);
    expect(out.json.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });
  it("emits compiled predicates, minified keys, and mapped personas", () => {
    const book = {
      book_id: "b",
      version: 7,
      config: { vars: [{ key: "x" }], bands: [{ key: "stable", predicate: { all: [{ var: "x", op: ">=", value: 5 }] } }] },
      personas: [{ persona_id: "p" }],
      chapters: [
        {
          chapter_id: "cx",
          decisions: [
            {
              id: "d",
              prompt: "P",
              options: [
                {
                  id: "o",
                  label: "L",
                  intent: "I",
                  next: "chapter_end",
                  requires: { all: [{ var: "x", op: ">=", value: 1 }] },
                  lock_reason: "R",
                  persona_effects: [{ persona_id: "p", delta: { x: 1 }, outcome_text: "Outcome text here." }],
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = JSON.parse(compile(book).json);
    expect(parsed.format).toBe(1);
    expect(parsed.version).toBe(7);
    expect(Object.keys(parsed.personasById)).toEqual(["p"]);
    const opt = parsed.chaptersById.cx.optionsById.o;
    expect(opt.e.p.d).toEqual({ x: 1 });
    expect(opt.e.p.o).toContain("Outcome");
    expect(opt.requires_compiled.startsWith("s =>")).toBe(true);
    expect(opt.requires).toBeUndefined();
    expect(opt.r).toBeDefined();
    expect(parsed.config.bands_compiled[0]).toEqual({ key: "stable", fn: expect.stringMatching(/^s =>/) });
  });
});
