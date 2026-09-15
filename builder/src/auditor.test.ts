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
  it("ignores options with no delta keys at all", () => {
    expect(auditDecision(D({}, {}), ["p"])).toEqual([]);
  });
  it("flags a single-option decision as vacuous (schema requires ≥2 upstream)", () => {
    expect(auditDecision(D({ x: 1 }), ["p"]).some((e) => e.code === "MEANINGLESS")).toBe(true);
  });
  it("passes a 3-option tradeoff", () => {
    expect(auditDecision(D({ x: 3 }, { y: 3 }, { x: 1, y: 1 }), ["p"])).toEqual([]);
  });
  it("isolates findings per persona", () => {
    const decision = {
      id: "d",
      options: [
        { id: "o1", persona_effects: [{ persona_id: "p1", delta: { x: 1 } }, { persona_id: "p2", delta: { x: 5, y: -2 } }] },
        { id: "o2", persona_effects: [{ persona_id: "p1", delta: { x: 1 } }, { persona_id: "p2", delta: { x: -1, y: 4 } }] },
      ],
    };
    const out = auditDecision(decision, ["p1", "p2"]);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe("MEANINGLESS");
    expect(out[0].message).toContain("p1");
  });
  it("treats a missing persona entry as a zero vector, not a crash", () => {
    const decision = {
      id: "d",
      options: [
        { id: "o1", persona_effects: [{ persona_id: "p1", delta: { x: 2 } }] },
        { id: "o2", persona_effects: [{ persona_id: "p1", delta: { y: 2 } }] },
      ],
    };
    // p1 faces a real tradeoff; p2's zero-vectors are skipped via empty keys.
    expect(auditDecision(decision, ["p1", "p2"])).toEqual([]);
  });
});
