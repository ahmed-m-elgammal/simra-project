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
});

describe("schemas edge cases", () => {
  const good = () => JSON.parse(JSON.stringify(load("habits-ch1.canonical.json")));
  const opt = () => JSON.parse(JSON.stringify(good().decisions[0].options[0]));

  it("rejects fewer than 2 or more than 4 options", () => {
    const one = good();
    one.decisions[0].options = [opt()];
    expect(CanonicalChapterSchema.safeParse(one).success).toBe(false);
    const five = good();
    five.decisions[0].options = [opt(), opt(), opt(), opt(), opt()];
    expect(CanonicalChapterSchema.safeParse(five).success).toBe(false);
  });
  it("rejects unknown display, bad sourcing mode, negative order", () => {
    const a = good();
    a.new_variables[0].display = "gauge";
    expect(CanonicalChapterSchema.safeParse(a).success).toBe(false);
    const b = good();
    b.sourcing.mode = "extracted";
    expect(CanonicalChapterSchema.safeParse(b).success).toBe(false);
    const c = good();
    c.order = -1;
    expect(CanonicalChapterSchema.safeParse(c).success).toBe(false);
  });
  it("rejects oversized outcome_text and empty predicate lists", () => {
    const a = good();
    a.decisions[0].options[0].persona_effects[0].outcome_text = "a".repeat(2001);
    expect(CanonicalChapterSchema.safeParse(a).success).toBe(false);
    const b = good();
    b.decisions[0].options[0].requires = { all: [] };
    expect(CanonicalChapterSchema.safeParse(b).success).toBe(false);
  });
  it("rejects non-string ids and missing lock_reason", () => {
    const a = good();
    a.decisions[0].id = 123;
    expect(CanonicalChapterSchema.safeParse(a).success).toBe(false);
    const b = good();
    delete b.decisions[0].options[0].lock_reason;
    expect(CanonicalChapterSchema.safeParse(b).success).toBe(false);
  });
});
