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
  it("k=1 proposes no cuts; k>3 and empty input throw", () => {
    expect(proposeBands([4, 8, 15], 1)).toEqual([]);
    expect(() => proposeBands([1, 2, 3], 4)).toThrow(/k≤3/);
    expect(() => proposeBands([], 2)).toThrow();
  });
  it("single value proposes cuts at that value", () => {
    const cuts = proposeBands([5], 2);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toBe(5);
  });
  it("keeps min<=mean<=max and accumulates fixed deltas exactly", () => {
    const g = {
      start: { x: 0, y: 10 },
      steps: [{ options: [{ delta: { x: 1 } }, { delta: { x: -1 } }] }, { options: [{ delta: { y: -2 } }] }],
    };
    const r = monteCarlo(g, 500, 7);
    expect(r.min.x).toBeLessThanOrEqual(r.mean.x);
    expect(r.mean.x).toBeLessThanOrEqual(r.max.x);
    expect(r.mean.y).toBe(8);
    expect(r.min.y).toBe(8);
    expect(r.max.y).toBe(8);
  });
});
