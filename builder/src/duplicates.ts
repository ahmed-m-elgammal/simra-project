import { cosine, type EmbeddingProvider } from "./embeddings/types.js";
import type { FakeEmbeddings } from "./embeddings/fake.js";

export interface DuplicateFinding {
  a: string;
  b: string;
  score: number;
  verdict: "merge" | "flag" | "note" | "keep";
}

export async function screenDuplicatesAsync(
  vars: Array<{ key: string; gloss: string }>,
  provider: EmbeddingProvider,
  thresholds = { flag: 0.85, note: 0.7 },
): Promise<DuplicateFinding[]> {
  const vecs = await provider.embed(vars.map((v) => v.gloss));
  const out: DuplicateFinding[] = [];
  for (let i = 0; i < vars.length; i++) {
    for (let j = i + 1; j < vars.length; j++) {
      const score = cosine(vecs[i], vecs[j]);
      out.push({
        a: vars[i].key,
        b: vars[j].key,
        score,
        verdict: score > thresholds.flag ? "flag" : score > thresholds.note ? "note" : "keep",
      });
    }
  }
  return out;
}

// Synchronous variant for deterministic unit tests. Uses the fake's
// similarity lookup directly instead of fabricating vectors.
export function screenDuplicates(
  vars: Array<{ key: string; gloss: string }>,
  provider: FakeEmbeddings,
  thresholds = { flag: 0.85, note: 0.7 },
): DuplicateFinding[] {
  const out: DuplicateFinding[] = [];
  for (let i = 0; i < vars.length; i++) {
    for (let j = i + 1; j < vars.length; j++) {
      const score = provider.getSim(vars[i].gloss, vars[j].gloss);
      out.push({
        a: vars[i].key,
        b: vars[j].key,
        score,
        verdict: score > thresholds.flag ? "flag" : score > thresholds.note ? "note" : "keep",
      });
    }
  }
  return out;
}
