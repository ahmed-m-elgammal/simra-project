import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync } from "node:zlib";

export const KEYMAP = {
  delta: "d",
  outcome_text: "o",
  requires: "r",
  lock_reason: "l",
  effectsByPersona: "e",
  state_variables: "v",
} as const;

// Structural key rename (exact key match). The old string-replace version
// would also rewrite `"delta":`-shaped substrings inside outcome_text prose.
function renameKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[(KEYMAP as Record<string, string>)[k] ?? k] = renameKeys(v);
    }
    return out;
  }
  return value;
}

export function minifyBundle(bundle: unknown): { json: string; br: Buffer; gz: Buffer; sha: string } {
  const json = JSON.stringify(renameKeys(bundle));
  return {
    json,
    br: brotliCompressSync(Buffer.from(json)),
    gz: gzipSync(Buffer.from(json)),
    sha: createHash("sha256").update(json).digest("hex"),
  };
}
