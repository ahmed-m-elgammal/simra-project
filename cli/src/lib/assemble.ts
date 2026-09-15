import { accumulateLedger, withRules } from "./submit.js";
import { CliError, readState as read } from "./workdir.js";

export interface AssembledVar {
  key: string;
  label: string;
  type: string;
  range: [number | null, number | null];
  display: "bar" | "number" | "currency" | "percent";
  default_value: number;
  introduced_in: number;
}

export interface AssembledBook {
  book_id: string;
  version: number;
  config: { vars: AssembledVar[]; bands: Array<{ key: string; predicate: unknown }> };
  personas: unknown[];
  chapters: any[];
}

// Pure assembly from approved workdir state. Throws CliError VALIDATION when
// a tracked var has no new_variables declaration (persona seeds carry values
// only — metadata must be declared once, at introduction).
// versionOverride pins the bundle version (publish uses the dist file's
// version, since build already bumped config.next_version).
export function assembleBook(workdir: string, versionOverride?: number): AssembledBook {
  const config = read<{ book_id: string; locale: string; next_version: number }>(workdir, "bookforge.config.json");
  const personasFile = read<{ personas?: unknown[] }>(workdir, "personas.json");
  const sim = read<{ sim_chapters: Array<{ order: number }> }>(workdir, "sim_chapters.approved.json");
  const bandsFile = read<{ bands: Array<{ key: string; predicate: unknown }> }>(workdir, "bands.json");

  const chapters = sim.sim_chapters.map((s) => {
    const file = `chapters/${String(s.order).padStart(2, "0")}.approved.json`;
    try {
      return read<any>(workdir, file);
    } catch {
      throw new CliError("VALIDATION", `approved chapter missing for sim order ${s.order} (${file})`, withRules([{ code: "CHAPTER_GAP", message: `no approved chapter for sim order ${s.order}`, nodeIds: [file] }]));
    }
  });

  const metas = new Map<string, AssembledVar>();
  for (const ch of chapters) {
    for (const v of ch.new_variables ?? []) {
      if (typeof v?.key === "string" && !metas.has(v.key)) {
        metas.set(v.key, {
          key: v.key,
          label: v.label,
          type: v.type,
          range: v.range,
          display: v.display,
          default_value: v.default_value,
          introduced_in: ch.order ?? 0,
        });
      }
    }
  }

  // Every tracked var (personas + deltas) must resolve to one declaration.
  const ledger: Record<string, { introduced_in: number }> = {};
  try {
    for (const p of (personasFile.personas ?? []) as Array<{ starting_state?: Record<string, number> }>) {
      for (const k of Object.keys(p.starting_state ?? {})) ledger[k] ??= { introduced_in: 1 };
    }
  } catch {
    throw new CliError("VALIDATION", "personas.json unreadable during assembly");
  }
  for (const ch of chapters) accumulateLedger(ledger, ch);
  const orphans = Object.keys(ledger).filter((k) => !metas.has(k));
  if (orphans.length > 0) {
    throw new CliError("VALIDATION", `tracked vars without a new_variables declaration: ${orphans.join(", ")}`, [
      { code: "VAR_WITHOUT_METADATA", message: `declare ${orphans.join(", ")} via a chapter's new_variables`, nodeIds: orphans, rule: "Every tracked var needs one new_variables declaration; persona seeds alone are not enough." },
    ]);
  }

  return {
    book_id: config.book_id,
    version: versionOverride ?? config.next_version,
    config: { vars: [...metas.values()], bands: bandsFile.bands },
    personas: personasFile.personas ?? [],
    chapters,
  };
}
