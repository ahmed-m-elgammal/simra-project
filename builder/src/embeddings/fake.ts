import type { EmbeddingProvider } from "./types.js";

export class FakeEmbeddings implements EmbeddingProvider {
  constructor(private sim: Record<string, number>) {}

  getSim(a: string, b: string): number {
    return this.sim[`${a}\0${b}`] ?? this.sim[`${b}\0${a}`] ?? 0;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t, i) => {
      if (i === 0) return new Float32Array([1, 0]);
      const s = this.getSim(texts[0], t);
      return new Float32Array([s, Math.sqrt(Math.max(0, 1 - s * s))]);
    });
  }
}
