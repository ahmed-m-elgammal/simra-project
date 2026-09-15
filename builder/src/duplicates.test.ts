import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { screenDuplicates, screenDuplicatesAsync } from "./duplicates.js";
import { FakeEmbeddings } from "./embeddings/fake.js";
import { cosine } from "./embeddings/types.js";

const dir = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(dir, "..", "fixtures", "duplicates.fixtures.json"), "utf8"));

describe("screenDuplicates", () => {
  it("flags/merges/keeps per fixtures", () => {
    const out = screenDuplicates(fx.vars, new FakeEmbeddings(fx.similarity), { flag: 0.85, note: 0.7 });
    for (const e of fx.expected) {
      const got = out.find((r) => r.a === e.a && r.b === e.b);
      expect(got?.verdict).toBe(e.verdict);
    }
  });
  it("treats exact 0.85 as note and exact 0.70 as keep (strict >)", () => {
    const vars = [
      { key: "a", gloss: "A" },
      { key: "b", gloss: "B" },
      { key: "c", gloss: "C" },
    ];
    const out = screenDuplicates(vars, new FakeEmbeddings({ "A\0B": 0.85, "A\0C": 0.7 }), { flag: 0.85, note: 0.7 });
    expect(out.find((r) => r.b === "b")?.verdict).toBe("note");
    expect(out.find((r) => r.b === "c")?.verdict).toBe("keep");
  });
  it("returns [] for zero or one variable", () => {
    const fake = new FakeEmbeddings({});
    expect(screenDuplicates([], fake)).toEqual([]);
    expect(screenDuplicates([{ key: "a", gloss: "A" }], fake)).toEqual([]);
  });
  it("honors custom thresholds", () => {
    const vars = [
      { key: "a", gloss: "A" },
      { key: "b", gloss: "B" },
    ];
    const out = screenDuplicates(vars, new FakeEmbeddings({ "A\0B": 0.62 }), { flag: 0.5, note: 0.2 });
    expect(out[0].verdict).toBe("flag");
  });
  it("async variant scores through real vector math", async () => {
    const vars = [
      { key: "debt", gloss: "Debt: money currently owed to lenders" },
      { key: "owed", gloss: "What you owe: total outstanding borrowed money" },
    ];
    const out = await screenDuplicatesAsync(
      vars,
      new FakeEmbeddings({ "Debt: money currently owed to lenders\0What you owe: total outstanding borrowed money": 0.93 }),
    );
    expect(out[0].verdict).toBe("flag");
    expect(out[0].score).toBeCloseTo(0.93, 5);
  });
  it("cosine: orthogonal is 0, identical is 1", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1);
  });
});
