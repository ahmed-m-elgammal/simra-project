import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CanonicalChapterSchema } from "./schemas.js";

const dir = dirname(fileURLToPath(import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(join(dir, "..", "fixtures", n), "utf8"));

describe("schemas", () => {
  it("accepts a valid chapter", () => {
    expect(CanonicalChapterSchema.safeParse(load("habits-ch1.canonical.json")).success).toBe(true);
  });
  it("rejects an option missing a persona effect", () => {
    const r = CanonicalChapterSchema.safeParse(load("invalid-missing-persona.json"));
    expect(r.success).toBe(false);
  });
});
