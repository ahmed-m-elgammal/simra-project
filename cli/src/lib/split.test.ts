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

  // --- F1 regression suite: real-world heading conventions ---

  it("detects spelled-out chapter numbers", () => {
    const out = splitChapters("Chapter One\nfirst words\nChapter Twelve\nsecond words\nchapter twenty-one\nlast words");
    expect(out.map((c) => c.title)).toEqual(["Chapter One", "Chapter Twelve", "chapter twenty-one"]);
    expect(out.every((c) => c.marker_type === "regex")).toBe(true);
  });

  it("detects roman-numeral chapter and part markers", () => {
    const out = splitChapters("Chapter IV: The Turning\nbody text here\nChapter IX\nmore body\nPart II — The Turn\nend words");
    expect(out.map((c) => c.title)).toEqual(["Chapter IV: The Turning", "Chapter IX", "Part II — The Turn"]);
    expect(out.every((c) => c.marker_type === "regex")).toBe(true);
  });

  it("detects mixed arabic/spelled conventions in one book", () => {
    const out = splitChapters("Part One\nfront words\nChapter 2\nmiddle words\nCHAPTER THREE\nmore words");
    expect(out.map((c) => c.title)).toEqual(["Part One", "Chapter 2", "CHAPTER THREE"]);
  });

  it("does not treat prose continuation lines as chapter markers", () => {
    const out = splitChapters("chapter 3 discusses the idea at length on and on\nCHAPTER 4\nReal body here");
    expect(out.map((c) => c.title)).toEqual(["CHAPTER 4"]);
  });

  it("does not treat 'part is…' prose as a Part marker", () => {
    const out = splitChapters("part is going well overall\nCHAPTER 1\nbody here");
    expect(out.map((c) => c.title)).toEqual(["CHAPTER 1"]);
  });

  it("rejects TOC entries with dot leaders or trailing page refs", () => {
    const out = splitChapters("TABLE OF CONTENTS\nCHAPTER 1 .......... 5\nCHAPTER 2\nReal body here");
    expect(out.map((c) => c.title)).toEqual(["CHAPTER 2"]);
  });

  it("splits a numbered '1. Title' book", () => {
    const body = "Long body text. ".repeat(30);
    const out = splitChapters(`1. No One's Crazy\n${body}\n2. Luck & Risk\n${body}\n3. Never Enough\n${body}`);
    expect(out.map((c) => c.title)).toEqual(["1. No One's Crazy", "2. Luck & Risk", "3. Never Enough"]);
    expect(out.every((c) => c.marker_type === "regex")).toBe(true);
  });

  it("rejects a tight numbered list (not chapters) even without other markers", () => {
    expect(() => splitChapters("Intro paragraph here.\n1. Do this\n2. Do that\n3. Do more\nclosing paragraph.")).toThrow(
      /NO_CHAPTER_MARKERS/,
    );
  });

  it("rejects numbered candidates whose numbering restarts", () => {
    const body = "Long body text. ".repeat(30);
    expect(() => splitChapters(`1. First\n${body}\n2. Second\n${body}\n3. Third\n${body}\n1. Restart\n${body}`)).toThrow(
      /NO_CHAPTER_MARKERS/,
    );
  });

  it("ignores a too-short numbered run (2 items)", () => {
    const body = "Long body text. ".repeat(30);
    expect(() => splitChapters(`1. First\n${body}\n2. Second\n${body}`)).toThrow(/NO_CHAPTER_MARKERS/);
  });

  it("keeps numbered chapters together with caps front matter", () => {
    const body = "Long body text. ".repeat(30);
    const out = splitChapters(`PREFACE\nsome words\n1. First\n${body}\n2. Second\n${body}\n3. Third\n${body}`);
    expect(out.map((c) => c.title)).toEqual(["PREFACE", "1. First", "2. Second", "3. Third"]);
    expect(out[0].marker_type).toBe("fallback");
  });

  it("drops copyright/front-matter junk caps lines", () => {
    const out = splitChapters("COPYRIGHT\nPublisher text here.\nTABLE OF CONTENTS\nListing of chapters.\nCHAPTER 1\nReal body.\nALL RIGHTS RESERVED\nLegal text.");
    expect(out.map((c) => c.title)).toEqual(["CHAPTER 1"]);
  });

  it("drops running headers repeated three or more times", () => {
    const out = splitChapters("THE GREAT BOOK\npara one text\nCHAPTER 1\nbody here\nTHE GREAT BOOK\npara two text\nCHAPTER 2\nbody two\nTHE GREAT BOOK\npara three");
    expect(out.map((c) => c.title)).toEqual(["CHAPTER 1", "CHAPTER 2"]);
  });

  it("keeps a caps title that appears exactly twice", () => {
    const out = splitChapters("INTERLUDE\nwords\nCHAPTER 1\nbody\nINTERLUDE\nmore words\nCHAPTER 2\nbody");
    expect(out.map((c) => c.title)).toEqual(["INTERLUDE", "CHAPTER 1", "INTERLUDE", "CHAPTER 2"]);
  });

  it("trusts ALL-CAPS markers only at page starts when page info is given", () => {
    const text = "INTRO\nbody text\nMIDPAGE SHOUT\nmore body";
    expect(splitChapters(text).map((c) => c.title)).toEqual(["INTRO", "MIDPAGE SHOUT"]);
    const paged = splitChapters(text, { pages: [text] });
    expect(paged.map((c) => c.title)).toEqual(["INTRO"]);
  });

  it("rescues graphic-title books via the page-structure fallback", () => {
    const intro = "Intro prose. ".repeat(30);
    const ch1 = "Chapter one prose. ".repeat(30);
    const ch2 = "Chapter two prose. ".repeat(30);
    const pages = ["", "", intro, "", ch1, ch1, "", ch2]; // blanks = graphic title pages
    const out = splitChapters(pages.join("\n"), { pages });
    expect(out.map((c) => c.title)).toEqual(["Untitled Section 1", "Untitled Section 2", "Untitled Section 3"]);
    expect(out.every((c) => c.marker_type === "heuristic")).toBe(true);
    expect(out[1].text).toContain("Chapter one prose");
    expect(out[2].text).toContain("Chapter two prose");
  });

  it("drops a trailing blank page instead of emitting an empty segment", () => {
    const prose = "Body prose. ".repeat(30);
    const pages = ["", prose, "", prose, prose, ""];
    const out = splitChapters(pages.join("\n"), { pages });
    expect(out).toHaveLength(2);
    expect(out[1].text).toContain("Body prose");
  });

  it("still throws NO_CHAPTER_MARKERS when pages carry no structure at all", () => {
    const pages = ["just prose without any headings. ".repeat(10), "more prose. ".repeat(10), "even more. ".repeat(10), "again. ".repeat(10), "last. ".repeat(10)];
    expect(() => splitChapters(pages.join("\n"), { pages })).toThrow(/NO_CHAPTER_MARKERS/);
  });

  it("ignores a mismatched pages array instead of mis-splitting", () => {
    const text = "CHAPTER 1\nbody here";
    const out = splitChapters(text, { pages: ["unrelated\npage\ntext"] });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("CHAPTER 1");
  });

  it("slices text exactly at the marker offsets", () => {
    const text = "FOREWORD\nwords\nCHAPTER 1\nbody\nCHAPTER 2: Titled\nmore";
    const full = text;
    for (const c of splitChapters(full)) {
      expect(full.slice(c.char_start, c.char_end).trim().startsWith(c.title)).toBe(true);
    }
  });
});
