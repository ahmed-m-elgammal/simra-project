import type { EmbeddingProvider } from "./types.js";

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

// Manual-test only: never imported by unit tests (the ~120MB model must
// not download in CI). The lab procedure in prepare-algorithms.md §3b
// picks challengers; this class runs the pinned incumbent.
export class TransformersEmbeddings implements EmbeddingProvider {
  private pipe: any = null;

  async embed(texts: string[]): Promise<Float32Array[]> {
    const { pipeline } = await import("@huggingface/transformers");
    this.pipe ??= await pipeline("feature-extraction", MODEL);
    const out = await this.pipe(texts, { pooling: "mean", normalize: true });
    return (out.tolist() as number[][]).map((v) => new Float32Array(v));
  }
}
