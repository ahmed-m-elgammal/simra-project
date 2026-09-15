import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { screenDuplicates } from "./duplicates.js";
import { FakeEmbeddings } from "./embeddings/fake.js";

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
});
