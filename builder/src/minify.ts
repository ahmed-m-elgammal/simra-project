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

export function minifyBundle(bundle: unknown): { json: string; br: Buffer; gz: Buffer; sha: string } {
  const raw = JSON.stringify(bundle);
  let json = raw;
  for (const [long, short] of Object.entries(KEYMAP)) {
    json = json.split(`"${long}":`).join(`"${short}":`);
  }
  return {
    json,
    br: brotliCompressSync(Buffer.from(json)),
    gz: gzipSync(Buffer.from(json)),
    sha: createHash("sha256").update(json).digest("hex"),
  };
}
