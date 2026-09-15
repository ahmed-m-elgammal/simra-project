import { quantileSorted } from "simple-statistics";

export function proposeBands(values: number[], k: number): number[] {
  if (k > 3) throw new Error("k≤3 per spec");
  if (values.length === 0) throw new Error("proposeBands needs observed values");
  const sorted = [...values].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let i = 1; i < k; i++) cuts.push(quantileSorted(sorted, i / k));
  return cuts;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function monteCarlo(
  graph: { start: Record<string, number>; steps: Array<{ options: Array<{ delta: Record<string, number> }> }> },
  walks: number,
  seed: number,
): { mean: Record<string, number>; min: Record<string, number>; max: Record<string, number> } {
  const rand = mulberry32(seed);
  const sums: Record<string, number> = {};
  const mins: Record<string, number> = {};
  const maxs: Record<string, number> = {};
  for (let w = 0; w < walks; w++) {
    const state = { ...graph.start };
    for (const step of graph.steps) {
      const o = step.options[Math.floor(rand() * step.options.length)];
      for (const [k, v] of Object.entries(o.delta)) state[k] = (state[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(state)) {
      sums[k] = (sums[k] ?? 0) + v;
      mins[k] = Math.min(mins[k] ?? v, v);
      maxs[k] = Math.max(maxs[k] ?? v, v);
    }
  }
  const mean: Record<string, number> = {};
  for (const k of Object.keys(sums)) mean[k] = sums[k] / walks;
  return { mean, min: mins, max: maxs };
}
