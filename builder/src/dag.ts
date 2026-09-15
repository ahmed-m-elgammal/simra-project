import type { ValidationError } from "./index.js";

interface DecisionLike {
  id: string;
  options: Array<{ id: string; next: string }>;
}

function adjacency(decisions: DecisionLike[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const d of decisions) {
    adj.set(
      d.id,
      d.options.map((o) => o.next).filter((n) => n !== "chapter_end"),
    );
  }
  return adj;
}

export function checkDag(decisions: DecisionLike[]): ValidationError[] {
  const errs: ValidationError[] = [];
  if (decisions.length === 0) return errs;
  const ids = new Set<string>();
  for (const d of decisions) {
    ids.add(d.id);
    for (const o of d.options) ids.add(o.id);
  }
  const adj = adjacency(decisions);

  // Cycle detection (iterative DFS) + missing-target detection.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (start: string): void => {
    const work: Array<[string, number]> = [[start, 0]];
    while (work.length > 0) {
      const top = work[work.length - 1];
      const node = top[0];
      if ((color.get(node) ?? WHITE) === WHITE) {
        color.set(node, GRAY);
        stack.push(node);
      }
      const nexts = adj.get(node) ?? [];
      if (top[1] < nexts.length) {
        top[1] += 1;
        const m = nexts[top[1] - 1];
        if (!ids.has(m)) {
          errs.push({ code: "DAG_DEAD_END", message: `next target missing: ${m}`, nodeIds: [node] });
          continue;
        }
        const c = color.get(m) ?? WHITE;
        if (c === GRAY) {
          const cyc = [...stack.slice(stack.indexOf(m)), m];
          errs.push({ code: "DAG_CYCLE", message: `cycle: ${cyc.join(" -> ")}`, nodeIds: cyc });
        } else if (c === WHITE) {
          work.push([m, 0]);
        }
      } else {
        color.set(node, BLACK);
        stack.pop();
        work.pop();
      }
    }
  };
  for (const d of decisions) {
    if ((color.get(d.id) ?? WHITE) === WHITE) visit(d.id);
  }

  // Reachability from the chapter entry (first decision).
  const seen = new Set<string>();
  const queue = [decisions[0].id];
  while (queue.length > 0) {
    const n = queue.pop() as string;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of adj.get(n) ?? []) if (!seen.has(m)) queue.push(m);
  }
  for (const d of decisions) {
    if (!seen.has(d.id)) errs.push({ code: "DAG_ORPHAN", message: `unreachable decision: ${d.id}`, nodeIds: [d.id] });
  }

  // Termination: every decision reaches chapter_end.
  const reachesEnd = (start: string): boolean => {
    const visited = new Set<string>([start]);
    const q = [start];
    while (q.length > 0) {
      const n = q.pop() as string;
      const d = decisions.find((x) => x.id === n);
      for (const o of d?.options ?? []) {
        if (o.next === "chapter_end") return true;
        if (!visited.has(o.next) && ids.has(o.next)) {
          visited.add(o.next);
          q.push(o.next);
        }
      }
    }
    return false;
  };
  for (const d of decisions) {
    if (!reachesEnd(d.id)) errs.push({ code: "DAG_DEAD_END", message: `no path to chapter_end from ${d.id}`, nodeIds: [d.id] });
  }
  return errs;
}
