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
});
