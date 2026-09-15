export interface AuditFinding {
  code: "MEANINGLESS" | "DOMINANT";
  message: string;
}

export function auditDecision(decision: any, personaIds: string[]): AuditFinding[] {
  const out: AuditFinding[] = [];
  const options = (decision.options ?? []) as Array<{
    persona_effects?: Array<{ persona_id?: string; delta?: Record<string, number> }>;
  }>;
  for (const p of personaIds) {
    const vecs: Array<Record<string, number>> = options.map(
      (o) => o.persona_effects?.find((e) => e.persona_id === p)?.delta ?? {},
    );
    const keys: string[] = [...new Set(vecs.flatMap((v) => Object.keys(v)))];
    if (keys.length === 0) continue;
    if (vecs.every((v) => keys.every((k) => (v[k] ?? 0) === (vecs[0][k] ?? 0)))) {
      out.push({ code: "MEANINGLESS", message: `all options identical for ${p} in ${decision.id ?? "decision"}` });
    }
    for (let i = 0; i < vecs.length; i++) {
      const dom = vecs.every((v, j) => j === i || keys.every((k) => (vecs[i][k] ?? 0) >= (v[k] ?? 0)));
      const strict = vecs.some((v, j) => j !== i && keys.some((k) => (vecs[i][k] ?? 0) > (v[k] ?? 0)));
      if (dom && strict) {
        out.push({ code: "DOMINANT", message: `option ${i} dominates for ${p} (advisory, reviewer may override)` });
        break;
      }
    }
  }
  return out;
}
