import { describe, expect, it } from "vitest";
import { splitChapters } from "./split.js";

const TEXT = "FOREWORD\nblah\nCHAPTER 1\nIntro text here.\nCHAPTER 2\nMore text.\nCHAPTER 3\nEnd.";

describe("splitChapters", () => {
  it("detects chapter markers and keeps offsets", () => {
    const out = splitChapters(TEXT);
    // FOREWORD is front matter but still a segment (segmentation decides what to use).
    expect(out.map((c) => c.title)).toEqual(["FOREWORD", "CHAPTER 1", "CHAPTER 2", "CHAPTER 3"]);
    expect(out[1].char_start).toBeGreaterThan(0);
    expect(out[3].char_end).toBe(TEXT.length);
    expect(out[1].text).toContain("Intro text");
  });
  it("throws a machine error when no markers found", () => {
    expect(() => splitChapters("no markers at all here")).toThrow(/NO_CHAPTER_MARKERS/);
  });
  it("detects Part/Ch/chapter variants case-insensitively", () => {
    const out = splitChapters("PART 1\nopening words\nCh 2\nmiddle words\nchapter 10\nclosing words");
    expect(out.map((c) => c.title)).toEqual(["PART 1", "Ch 2", "chapter 10"]);
    expect(out.every((c) => c.marker_type === "regex")).toBe(true);
  });
  it("treats a 60-char all-caps line as prose, shorter as fallback", () => {
    const long = "A".repeat(60);
    const out = splitChapters(`CHAPTER 1\n${long}\nCHAPTER 2\ntext`);
    expect(out).toHaveLength(2);
    const short = splitChapters(`CHAPTER 1\ntext\nAN INTERLUDE\nCHAPTER 2\nmore`);
    expect(short.map((c) => c.title)).toEqual(["CHAPTER 1", "AN INTERLUDE", "CHAPTER 2"]);
    expect(short[1].marker_type).toBe("fallback");
  });
  it("keeps segments contiguous and covers the full text", () => {
    const out = splitChapters("CHAPTER 1\nA\nCHAPTER 2\nB\nCHAPTER 3\nC");
    for (let i = 1; i < out.length; i++) expect(out[i].char_start).toBe(out[i - 1].char_end);
    expect(out[out.length - 1].char_end).toBe("CHAPTER 1\nA\nCHAPTER 2\nB\nCHAPTER 3\nC".length);
  });
  it("keeps duplicate titles as separate segments", () => {
    const out = splitChapters("CHAPTER 1\nfirst body here\nCHAPTER 1\nsecond body here");
    expect(out).toHaveLength(2);
    expect(out[0].id).not.toBe(out[1].id);
  });
  it("handles a single chapter spanning the whole text", () => {
    const out = splitChapters("CHAPTER 1\nOnly chapter here.");
    expect(out).toHaveLength(1);
    expect(out[0].char_end).toBe("CHAPTER 1\nOnly chapter here.".length);
  });
});
