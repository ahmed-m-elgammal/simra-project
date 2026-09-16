import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError } from "./workdir.js";
import { approvedChapters, buildLedger, personaIdsOf, submitJson, withRules } from "./submit.js";
import { seedFullWorkdir } from "../../fixtures/minibook/seed-workdir.js";

describe("submit lib", () => {
  it("submitJson reports missing files and bad JSON distinctly", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    try {
      submitJson(join(dir, "nope.json"), { safeParse: (x: unknown) => ({ success: true as const, data: x }) } as never);
      expect.unreachable();
    } catch (e) {
      expect((e as CliError).code).toBe("MISSING_INPUT");
    }
    writeFileSync(join(dir, "bad.json"), "{oops");
    try {
      submitJson(join(dir, "bad.json"), { safeParse: (x: unknown) => ({ success: true as const, data: x }) } as never);
      expect.unreachable();
    } catch (e) {
      expect((e as CliError).code).toBe("VALIDATION");
    }
  });
  it("buildLedger accumulates first-wins across approved chapters", () => {
    const dir = seedFullWorkdir();
    const ledger = buildLedger(dir);
    expect(ledger).toEqual({ consistency: { introduced_in: 1 } });
  });
  it("orders approved chapters numerically beyond two digits", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    const chapters = join(dir, "chapters");
    mkdirSync(chapters, { recursive: true });
    for (const order of [2, 100, 11, 1]) writeFileSync(join(chapters, `${String(order).padStart(2, "0")}.approved.json`), "{}");
    expect(approvedChapters(dir)).toEqual(["01.approved.json", "02.approved.json", "11.approved.json", "100.approved.json"]);
  });
  it("personaIdsOf returns [] without personas", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    expect(personaIdsOf(dir)).toEqual([]);
    const dir2 = seedFullWorkdir();
    expect(personaIdsOf(dir2).sort()).toEqual(["maya", "omar"]);
  });
  it("withRules fills rule text and defaults unknown codes to empty", () => {
    const out = withRules([
      { code: "NO_OPEN_OPTION", message: "m", nodeIds: ["d"] },
      { code: "SOMETHING_NEW", message: "m", nodeIds: [] },
    ]);
    expect(out[0].rule.length).toBeGreaterThan(0);
    expect(out[1].rule).toBe("");
  });
});
