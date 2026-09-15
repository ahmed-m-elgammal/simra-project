import { describe, expect, it } from "vitest";
import { countWords, keyExists, placeholderVars, requiresVars } from "./ledger.js";

describe("ledger helpers", () => {
  it("extracts multiple placeholders", () => {
    expect(placeholderVars("a {x} b {y} c")).toEqual(["x", "y"]);
  });
  it("returns [] when no placeholders", () => {
    expect(placeholderVars("plain prose, no vars")).toEqual([]);
  });
  it("extracts adjacent placeholders", () => {
    expect(placeholderVars("{x}{y}")).toEqual(["x", "y"]);
  });
  it("ignores spaced braces", () => {
    expect(placeholderVars("{ spaced } and {x}")).toEqual(["x"]);
  });
  it("counts words across whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
    expect(countWords("a  b\nc")).toBe(3);
  });
  it("collects requires vars through any/not nesting", () => {
    expect(
      requiresVars({ any: [{ var: "x", op: "==", value: 1 }, { not: { all: [{ var: "y", op: "<", value: 0 }] } }] }),
    ).toEqual(["x", "y"]);
  });
  it("returns [] for null or non-object requires", () => {
    expect(requiresVars(null)).toEqual([]);
    expect(requiresVars("x>=1")).toEqual([]);
  });
  it("keyExists ignores prototype keys", () => {
    expect(keyExists({ a: { introduced_in: 1 } }, "a")).toBe(true);
    expect(keyExists({ a: { introduced_in: 1 } }, "missing")).toBe(false);
    expect(keyExists({ a: { introduced_in: 1 } }, "toString")).toBe(false);
  });
});
