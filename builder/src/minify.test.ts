import { describe, expect, it } from "vitest";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { KEYMAP, minifyBundle } from "./minify.js";

describe("minifyBundle", () => {
  it("renames exactly the mapped keys", () => {
    const out = minifyBundle({ delta: { x: 1 }, outcome_text: "t", other: 2 });
    expect(out.json).toContain('"d":');
    expect(out.json).toContain('"o":');
    expect(out.json).not.toContain('"delta":');
    expect(out.json).not.toContain('"outcome_text":');
    expect(out.json).toContain('"other":');
    expect(Object.keys(KEYMAP)).toHaveLength(6);
  });
  it("renames by exact key match only; key-shaped prose survives", () => {
    const text = 'She said "requires": patience, and the "delta": was small.';
    const out = minifyBundle({ outcome_text: text });
    // Values survive JSON-escaped but otherwise untouched: no key rename inside prose.
    expect(out.json).toContain(JSON.stringify(text).slice(1, -1));
    expect(out.json).not.toContain('"r":');
    expect(JSON.parse(out.json).o).toBe(text);
  });
  it("round-trips through brotli and gzip", () => {
    const out = minifyBundle({ delta: { x: 1 } });
    expect(JSON.parse(brotliDecompressSync(out.br).toString("utf8"))).toEqual(JSON.parse(out.json));
    expect(JSON.parse(gunzipSync(out.gz).toString("utf8"))).toEqual(JSON.parse(out.json));
  });
  it("sha matches an independent hash of the json", () => {
    const out = minifyBundle({ a: [1, 2, 3] });
    expect(out.sha).toBe(createHash("sha256").update(out.json).digest("hex"));
    expect(out.sha).toMatch(/^[0-9a-f]{64}$/);
  });
  it("handles an empty bundle", () => {
    const out = minifyBundle({});
    expect(out.json).toBe("{}");
    expect(out.br.length).toBeGreaterThan(0);
  });
});
