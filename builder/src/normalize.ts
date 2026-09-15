export interface NormalizedChapter {
  chapter_id: string;
  decisionIds: string[];
  decisionsById: Record<string, { prompt: string; optionIds: string[] }>;
  optionsById: Record<
    string,
    {
      label: string;
      intent: string;
      next: string;
      requires: unknown;
      lock_reason: string;
      effectsByPersona: Record<string, { delta: Record<string, number>; outcome_text: string }>;
    }
  >;
}

export function normalizeChapter(ch: any): NormalizedChapter {
  const decisionsById: NormalizedChapter["decisionsById"] = {};
  const optionsById: NormalizedChapter["optionsById"] = {};
  const decisionIds: string[] = [];
  for (const d of ch.decisions) {
    decisionIds.push(d.id);
    decisionsById[d.id] = { prompt: d.prompt, optionIds: d.options.map((o: any) => o.id) };
    for (const o of d.options) {
      const effectsByPersona: Record<string, { delta: Record<string, number>; outcome_text: string }> = {};
      for (const e of o.persona_effects) {
        effectsByPersona[e.persona_id] = { delta: e.delta, outcome_text: e.outcome_text };
      }
      optionsById[o.id] = {
        label: o.label,
        intent: o.intent,
        next: o.next,
        requires: o.requires,
        lock_reason: o.lock_reason,
        effectsByPersona,
      };
    }
  }
  return { chapter_id: ch.chapter_id, decisionIds, decisionsById, optionsById };
}
