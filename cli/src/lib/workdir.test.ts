import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError, readState, statePath, writeState } from "./workdir.js";

describe("workdir", () => {
  it("round-trips JSON state and reports missing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    expect(() => readState(dir, "sim_chapters.json")).toThrowError(CliError);
    try {
      readState(dir, "sim_chapters.json");
      expect.unreachable();
    } catch (e) {
      expect((e as CliError).code).toBe("MISSING_INPUT");
    }
    writeState(dir, "sim_chapters.json", { ok: true });
    expect(readState(dir, "sim_chapters.json")).toEqual({ ok: true });
    expect(statePath(dir, "x.json").endsWith("x.json")).toBe(true);
  });
});
