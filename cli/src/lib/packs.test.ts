import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildBandsPack, buildChapterPack, buildPersonasPack, buildSegmentPack } from "./packs.js";

const dir = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => JSON.parse(readFileSync(join(dir, "..", "..", "fixtures", "minibook", n), "utf8"));

const base = () => ({
  book_id: "mini",
  locale: "en" as const,
  raw: fx("raw_chapters.json"),
  sim: fx("sim_chapters.json"),
  personas: fx("personas.json"),
  prior: [fx("chapters/01.json")],
  ledger: { consistency: { introduced_in: 1 } },
});

describe("packs", () => {
  it("chapter pack embeds schema + ledger + prior chapters + constraints", () => {
    const pack = buildChapterPack({ ...base(), chapterOrder: 2 });
    expect(pack.pack_format).toBe(1);
    expect(pack.schemaSource).toContain("persona_effects");
    expect(pack.schemaSource).toContain("RequiresSchema");
    expect(pack.constraints).toContain("requires");
    expect(pack.context.prior_chapters).toHaveLength(1);
    expect((pack.context.ledger as { consistency: { introduced_in: number } }).consistency.introduced_in).toBe(1);
  });
  it("chapter pack carries only its own source ranges", () => {
    const pack = buildChapterPack({ ...base(), chapterOrder: 2 });
    expect(pack.chapter?.source_text).toContain("Evenings decide tomorrow");
    expect(pack.chapter?.source_text).not.toContain("Mornings shape the day");
  });
  it("chapter packs are byte-stable (golden)", () => {
    const pack = buildChapterPack({ ...base(), chapterOrder: 2 });
    const golden = readFileSync(join(dir, "..", "..", "fixtures", "minibook", "chapter02.pack.golden.json"), "utf8");
    expect(JSON.stringify(pack)).toBe(golden.trim());
  });
  it("segment/personas/bands packs carry the right context", () => {
    const b = base();
    const seg = buildSegmentPack({ book_id: b.book_id, locale: b.locale, raw: b.raw });
    expect(seg.stage).toBe("segment");
    expect(seg.context.raw_chapters).toHaveLength(3);
    const per = buildPersonasPack({ book_id: b.book_id, locale: b.locale, raw: b.raw, sim: b.sim });
    expect(per.context.sim_chapters).toHaveLength(2);
    const bands = buildBandsPack({ book_id: b.book_id, locale: b.locale, prior: b.prior, ledger: b.ledger });
    const ranges = bands.context.observed_ranges as Record<string, { min: number; max: number }>;
    expect(ranges.consistency.min).toBeLessThanOrEqual(ranges.consistency.max);
  });
});
