import { describe, expect, it } from "vitest";
import { compileRequires, compileBand } from "./precompile.js";

const run = (fn: string, s: Record<string, number>): unknown => new Function("s", `return (${fn})(s);`)(s);

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
  it("compiles every operator", () => {
    const cases: Array<[string, number, number, boolean]> = [
      ["==", 1, 1, true],
      ["!=", 1, 2, true],
      ["<", 1, 2, true],
      ["<=", 2, 2, true],
      [">", 3, 2, true],
      [">=", 2, 2, true],
      ["==", 1, 2, false],
    ];
    for (const [op, state, value, expected] of cases) {
      const fn = compileRequires({ all: [{ var: "x", op, value }] });
      expect(run(fn, { x: state })).toBe(expected);
    }
  });
  it("treats empty all as true and empty any as false", () => {
    expect(run(compileRequires({ all: [] }), {})).toBe(true);
    expect(run(compileRequires({ any: [] }), {})).toBe(false);
  });
  it("evaluates deep any/not/all nesting", () => {
    const fn = compileRequires({
      any: [{ all: [{ var: "x", op: ">", value: 5 }] }, { not: { all: [{ var: "y", op: "==", value: 0 }] } }],
    });
    expect(run(fn, { x: 1, y: 1 })).toBe(true);
    expect(run(fn, { x: 1, y: 0 })).toBe(false);
  });
  it("enforces known vars and float values", () => {
    const atom = { var: "energy", op: ">", value: 0.5 };
    expect(run(compileRequires({ all: [atom] }, ["energy"]), { energy: 1 })).toBe(true);
    expect(() => compileRequires({ all: [atom] }, ["other"])).toThrow(/unknown var/);
  });
});
