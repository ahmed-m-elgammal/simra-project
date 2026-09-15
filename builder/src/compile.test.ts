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
});
