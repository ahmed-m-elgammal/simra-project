import type { ValidationError } from "./index.js";

interface DecisionLike {
  id: string;
  options: Array<{ id: string; persona_effects: Array<{ persona_id: string }> }>;
}

// Duplicate ids silently overwrite each other in byId maps (data loss),
// so they block publish instead.
export function checkDuplicateIds(decisions: DecisionLike[]): ValidationError[] {
  const errs: ValidationError[] = [];
  const seenDecisions = new Set<string>();
  const seenOptions = new Set<string>();
  for (const d of decisions) {
    if (seenDecisions.has(d.id)) {
      errs.push({ code: "DUPLICATE_ID", message: `duplicate decision id: ${d.id}`, nodeIds: [d.id] });
    }
    seenDecisions.add(d.id);
    for (const o of d.options) {
      if (seenOptions.has(o.id)) {
        errs.push({ code: "DUPLICATE_ID", message: `duplicate option id: ${o.id}`, nodeIds: [o.id] });
      }
      seenOptions.add(o.id);
      const seenPersonas = new Set<string>();
      for (const e of o.persona_effects ?? []) {
        if (seenPersonas.has(e.persona_id)) {
          errs.push({ code: "DUPLICATE_ID", message: `duplicate persona effect ${e.persona_id} in option ${o.id}`, nodeIds: [o.id] });
        }
        seenPersonas.add(e.persona_id);
      }
    }
  }
  return errs;
}
