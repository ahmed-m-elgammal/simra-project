import { describe, expect, it } from "vitest";
import { auditDecision } from "./auditor.js";

const D = (...deltas: Array<Record<string, number>>) => ({
  id: "dec1",
  options: deltas.map((delta, i) => ({ id: `o${i}`, persona_effects: [{ persona_id: "p", delta }] })),
});

describe("auditor", () => {
  it("flags a meaningless choice (identical deltas)", () => {
    expect(auditDecision(D({ x: 1 }, { x: 1 }), ["p"]).some((e) => e.code === "MEANINGLESS")).toBe(true);
  });
  it("flags a dominating option (better on every var)", () => {
    expect(auditDecision(D({ x: 1, y: 1 }, { x: 5, y: 5 }), ["p"]).some((e) => e.code === "DOMINANT")).toBe(true);
  });
  it("passes a real tradeoff", () => {
    expect(auditDecision(D({ x: 5, y: -2 }, { x: -1, y: 4 }), ["p"])).toEqual([]);
  });
});
