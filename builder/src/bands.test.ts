import { describe, expect, it } from "vitest";
import { proposeBands, monteCarlo } from "./bands.js";

describe("bands", () => {
  it("proposes 2 cuts inside the observed range", () => {
    const deltas = [2, 3, 3, 4, 5, 6, 8, 9, 12];
    const cuts = proposeBands(deltas, 3);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toBeGreaterThanOrEqual(Math.min(...deltas));
    expect(cuts[1]).toBeLessThanOrEqual(Math.max(...deltas));
    expect(cuts[0]).toBeLessThan(cuts[1]);
  });
  it("monte carlo is deterministic for the same seed", () => {
    const g = { start: { x: 0 }, steps: [{ options: [{ delta: { x: 1 } }, { delta: { x: -1 } }] }] };
    const a = monteCarlo(g, 1000, 42);
    const b = monteCarlo(g, 1000, 42);
    expect(a).toEqual(b);
    expect(a.mean.x).toBeCloseTo(0, 0);
  });
});
