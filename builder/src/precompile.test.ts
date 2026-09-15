import { describe, expect, it } from "vitest";
import { compileRequires, compileBand } from "./precompile.js";

const run = (fn: string, s: Record<string, number>): unknown => new Function("s", `return (${fn});`)(s);

describe("precompile", () => {
  it("compiles an all-predicate", () => {
    const fn = compileRequires({ all: [{ var: "energy", op: ">=", value: 4 }] });
    expect(run(fn, { energy: 5 })).toBe(true);
    expect(run(fn, { energy: 2 })).toBe(false);
  });
  it("compiles any/not nesting", () => {
    const fn = compileRequires({ any: [{ var: "a", op: "==", value: 1 }, { not: { all: [{ var: "b", op: "<", value: 0 }] } }] });
    expect(run(fn, { a: 0, b: 5 })).toBe(true);
  });
  it("rejects unknown ops and bad var names", () => {
    expect(() => compileRequires({ all: [{ var: "energy", op: "~=", value: 1 }] })).toThrow();
    expect(() => compileRequires({ all: [{ var: "drop table", op: "==", value: 1 }] })).toThrow();
  });
  it("compiles a band predicate identically", () => {
    const fn = compileBand({ all: [{ var: "consistency", op: ">=", value: 60 }] });
    expect(run(fn, { consistency: 70 })).toBe(true);
  });
});
