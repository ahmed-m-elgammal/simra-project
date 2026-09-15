import { describe, expect, it } from "vitest";
import { checkDag } from "./dag.js";

const dec = (id: string, ...nexts: string[]) => ({
  id,
  options: nexts.map((next, i) => ({ id: `${id}o${i}`, next })),
});

describe("checkDag", () => {
  it("accepts a linear chain", () => {
    expect(checkDag([dec("a", "b"), dec("b", "chapter_end")])).toEqual([]);
  });
  it("accepts a diamond (branch and merge)", () => {
    expect(checkDag([dec("a", "b", "c"), dec("b", "chapter_end"), dec("c", "chapter_end")])).toEqual([]);
  });
  it("reports a self-loop with the node twice", () => {
    const errs = checkDag([dec("a", "a")]);
    const cyc = errs.find((e) => e.code === "DAG_CYCLE");
    expect(cyc?.nodeIds).toEqual(["a", "a"]);
  });
  it("reports only the orphan (reachable parts stay clean)", () => {
    const errs = checkDag([dec("a", "chapter_end"), dec("b", "chapter_end")]);
    expect(errs).toHaveLength(1);
    expect(errs[0].code).toBe("DAG_ORPHAN");
    expect(errs[0].nodeIds).toEqual(["b"]);
  });
  it("flags a missing next target", () => {
    const errs = checkDag([dec("a", "ghost")]);
    expect(errs.some((e) => e.code === "DAG_DEAD_END" && e.message.includes("ghost"))).toBe(true);
  });
  it("flags a next pointing at an option id (never terminates)", () => {
    const errs = checkDag([dec("a", "ao0")]);
    expect(errs.some((e) => e.code === "DAG_DEAD_END")).toBe(true);
    expect(errs.some((e) => e.code === "DAG_CYCLE")).toBe(false);
  });
  it("accepts an empty chapter graph (schema requires ≥1 decision upstream)", () => {
    expect(checkDag([])).toEqual([]);
  });
});
