import type { ValidationError } from "./index.js";

interface DecisionLike {
  id: string;
  options: Array<{ requires: unknown }>;
}

export function checkOpenOption(decisions: DecisionLike[]): ValidationError[] {
  const errs: ValidationError[] = [];
  for (const d of decisions) {
    if (!d.options.some((o) => o.requires === null)) {
      errs.push({
        code: "NO_OPEN_OPTION",
        message: `decision has no always-available option: ${d.id}`,
        nodeIds: [d.id],
      });
    }
  }
  return errs;
}
