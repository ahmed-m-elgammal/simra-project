import { describe, expect, it } from "vitest";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliError } from "./workdir.js";
import { assembleBook } from "./assemble.js";
import { seedFullWorkdir } from "../../fixtures/minibook/seed-workdir.js";

describe("assembleBook", () => {
  it("assembles vars, bands, personas, chapters with the pinned version", () => {
    const book = assembleBook(seedFullWorkdir());
    expect(book.book_id).toBe("mini");
    expect(book.version).toBe(1);
    expect(book.config.vars).toEqual([
      { key: "consistency", label: "Consistency", type: "scale", range: [0, 100], display: "bar", default_value: 40, introduced_in: 1 },
    ]);
    expect(book.config.bands).toHaveLength(2);
    expect(book.personas).toHaveLength(2);
    expect(book.chapters).toHaveLength(2);
  });
  it("honors a version override", () => {
    expect(assembleBook(seedFullWorkdir(), 9).version).toBe(9);
  });
  it("rejects persona-seeded vars with no declaration", () => {
    const dir = seedFullWorkdir();
    const personas = JSON.parse(readFileSync(join(dir, "personas.json"), "utf8"));
    personas.personas[0].starting_state.mystery = 3;
    writeFileSync(join(dir, "personas.json"), JSON.stringify(personas));
    try {
      assembleBook(dir);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).details as Array<{ code: string }>).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "VAR_WITHOUT_METADATA" })]),
      );
    }
  });
  it("rejects a gap between sim orders and approved chapters", () => {
    const dir = seedFullWorkdir();
    rmSync(join(dir, "chapters", "02.approved.json"));
    expect(() => assembleBook(dir)).toThrow(/approved chapter missing for sim order 2/);
  });
});
