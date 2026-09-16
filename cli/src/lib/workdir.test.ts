import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError, exitCode, readState, statePath, writeState } from "./workdir.js";

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
  it("maps every code to its exit status", () => {
    expect(exitCode(new CliError("VALIDATION", "x"))).toBe(2);
    expect(exitCode(new CliError("MISSING_INPUT", "x"))).toBe(3);
    expect(exitCode(new CliError("GATE_OPEN", "x"))).toBe(4);
    expect(exitCode(new CliError("ABORTED", "x"))).toBe(4);
    expect(exitCode(new CliError("CONFLICT", "x"))).toBe(5);
    expect(exitCode(new Error("boom"))).toBe(1);
  });
  it("reports corrupt JSON as VALIDATION, not a raw SyntaxError", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    writeFileSync(join(dir, "broken.json"), "{nope");
    try {
      readState(dir, "broken.json");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("VALIDATION");
    }
  });
  it("creates nested parent dirs for subpath state names (F2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-"));
    writeState(dir, "chapters/01.json", { order: 1 });
    expect(readState(dir, "chapters/01.json")).toEqual({ order: 1 });
    writeState(dir, "a/b/c.json", { deep: true });
    expect(readState(dir, "a/b/c.json")).toEqual({ deep: true });
  });
  it("creates the workdir itself when it does not exist yet", () => {
    const dir = join(tmpdir(), `bf-fresh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      writeState(dir, "x.json", { ok: 1 });
      expect(readState(dir, "x.json")).toEqual({ ok: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
