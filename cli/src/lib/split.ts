export interface RawChapter {
  id: string;
  title: string;
  text: string;
  char_start: number;
  char_end: number;
  marker_type: "regex" | "fallback" | "heuristic";
}

export interface SplitOptions {
  /**
   * Per-page text from the PDF extractor (pages[i] = text of page i). When given,
   * ALL-CAPS fallback markers are only trusted at page starts (running headers and
   * mid-page junk are dropped), and a page-structure fallback splits books whose
   * headings are graphics-only in the text layer (blank chapter-title pages).
   */
  pages?: string[];
}

interface Mark {
  line: number;
  title: string;
  type: RawChapter["marker_type"];
  num?: number;
}

interface PageMapEntry {
  startLine: number;
  endLine: number; // exclusive
  firstNonEmpty: number | null;
}

const MAX_EXPLICIT_LEN = 80;
const MAX_CAPS_LEN = 60; // legacy: a 60-char all-caps line is prose
const NUMBERED_MIN = 3;
const NUMBERED_MIN_GAP = 200; // chars; tighter = a list, not chapters
const EMPTY_PAGE_MAX_CHARS = 40;
const MAX_HEURISTIC_SEGMENTS = 120; // more = scanned book with blank pages, not structure

const ARABIC = String.raw`\d{1,3}`;
const ROMAN = String.raw`(?=[MDCLXVI])M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})`;
const UNITS = "one|two|three|four|five|six|seven|eight|nine";
const TEENS = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const SPELLED = `(?:${TENS})(?:[- ](?:${UNITS}))?|(?:${TEENS})|(?:${UNITS})`;

const EXPLICIT_MARKER = new RegExp(
  String.raw`^(?:chapter\s+|ch\.?\s*|part\s+)(${ARABIC}|${ROMAN}|${SPELLED})\b[.:—–-]?(\s.*)?$`,
  "i",
);
const NUMBERED_MARKER = /^(\d{1,3})[.):]\s+\S/;
const TOC_ENTRY = /\.{2,}|\s{3,}\d{1,4}$/;
const SUPERSCRIPT = /[⁰¹²³⁴⁵⁶⁷⁸⁹]/;

const JUNK_CAPS = new Set([
  "contents",
  "table of contents",
  "copyright",
  "all rights reserved",
  "about the author",
  "about the authors",
  "about this book",
  "dedication",
  "colophon",
  "imprint",
  "title page",
  "half title",
  "halftitle",
  "front matter",
  "back matter",
  "index",
  "notes",
  "bibliography",
  "further reading",
  "also by",
  "cover",
]);
const JUNK_CAPS_PREFIX =
  /^(?:also by\b|praise for\b|more praise\b|copyright\b|©|isbn\b|printed in\b|(?:first|second|third|fourth|fifth|revised|updated) edition\b|edited by\b|translated by\b|(?:foreword|preface|afterword|introduction) by\b)/;

function isJunkHeading(t: string): boolean {
  const n = t.toLowerCase().replace(/\s+/g, " ").trim();
  return JUNK_CAPS.has(n) || JUNK_CAPS_PREFIX.test(n) || t.includes("©") || /\bEDITION\b/.test(t) || TOC_ENTRY.test(t);
}

function titleCaseStart(t: string): boolean {
  const s = t.replace(/^[^\p{L}\p{N}]+/u, ""); // strip leading punctuation (“— The Turn”)
  return /^[A-Z0-9]/.test(s) || s === s.toUpperCase();
}

function isCapsCandidate(t: string): boolean {
  return t.length >= 3 && t.length < MAX_CAPS_LEN && t === t.toUpperCase() && (t.match(/[A-Z]/g) ?? []).length >= 2 && !SUPERSCRIPT.test(t);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function buildPageMap(pages: string[] | undefined, lines: string[]): PageMapEntry[] | null {
  if (!pages || pages.length === 0) return null;
  const map: PageMapEntry[] = [];
  let cursor = 0;
  for (const pg of pages) {
    const n = pg.split("\n").length;
    let firstNonEmpty: number | null = null;
    for (let i = 0; i < n && cursor + i < lines.length; i++) {
      if (lines[cursor + i].trim().length > 0) {
        firstNonEmpty = cursor + i;
        break;
      }
    }
    map.push({ startLine: cursor, endLine: cursor + n, firstNonEmpty });
    cursor += n;
  }
  return cursor === lines.length ? map : null;
}

function detectExplicit(lines: string[]): Mark[] {
  const marks: Mark[] = [];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (t.length === 0 || t.length > MAX_EXPLICIT_LEN || TOC_ENTRY.test(t)) return;
    const m = EXPLICIT_MARKER.exec(t);
    if (!m) return;
    if (m[2] !== undefined && !titleCaseStart(m[2].trim())) return; // "chapter 3 discusses…" is prose
    marks.push({ line: i, title: t, type: "regex" });
  });
  return marks;
}

function detectNumbered(lines: string[], lineStart: number[]): Mark[] {
  const cands: Mark[] = [];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (t.length === 0 || t.length > MAX_EXPLICIT_LEN || TOC_ENTRY.test(t)) return;
    const m = NUMBERED_MARKER.exec(t);
    if (m) cands.push({ line: i, title: t, type: "regex", num: Number(m[1]) });
  });
  if (cands.length < NUMBERED_MIN || (cands[0].num ?? 0) > 2) return [];
  for (let k = 1; k < cands.length; k++) {
    if ((cands[k].num ?? 0) < (cands[k - 1].num ?? 0)) return []; // numbering restarted → not chapters
  }
  const gaps = cands.slice(1).map((c, k) => lineStart[c.line] - lineStart[cands[k].line]);
  if (Math.min(...gaps) < NUMBERED_MIN_GAP || median(gaps) < NUMBERED_MIN_GAP * 2) return [];
  return cands;
}

function detectCaps(lines: string[], pageMap: PageMapEntry[] | null): Mark[] {
  const counts = new Map<string, number>();
  lines.forEach((ln) => {
    const t = ln.trim();
    if (isCapsCandidate(t) && !isJunkHeading(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  });
  const marks: Mark[] = [];
  let page = 0;
  lines.forEach((ln, i) => {
    while (pageMap && page < pageMap.length - 1 && i >= pageMap[page].endLine) page++;
    const t = ln.trim();
    if (!isCapsCandidate(t) || isJunkHeading(t) || (counts.get(t) ?? 0) >= 3) return; // ×3 = running header
    if (pageMap && pageMap[page].firstNonEmpty !== i) return; // mid-page caps = body emphasis, not a heading
    marks.push({ line: i, title: t, type: "fallback" });
  });
  return marks;
}

function pageStructureMarks(pages: string[] | undefined, pageMap: PageMapEntry[] | null): Mark[] {
  if (!pageMap || !pages || pages.length < 4) return [];
  const seps = pages.map((pg) => pg.trim().length <= EMPTY_PAGE_MAX_CHARS);
  const bounds: number[] = [];
  seps.forEach((s, i) => {
    if (s && (i === 0 || !seps[i - 1])) bounds.push(i);
  });
  if (bounds.length === 0 || bounds.length > MAX_HEURISTIC_SEGMENTS) return [];
  const marks: Mark[] = [];
  bounds.forEach((p, k) => {
    const next = k + 1 < bounds.length ? bounds[k + 1] : pages.length;
    const hasContent = pages.slice(p, next).some((pg) => pg.trim().length > 0);
    if (!hasContent && bounds.length > 1) return; // trailing blank page / back cover
    marks.push({
      line: pageMap[p].firstNonEmpty ?? pageMap[p].startLine,
      title: `Untitled Section ${marks.length + 1}`,
      type: "heuristic",
    });
  });
  return marks;
}

export function splitChapters(fullText: string, opts: SplitOptions = {}): RawChapter[] {
  const lines = fullText.split("\n");
  const lineStart: number[] = [];
  let acc = 0;
  for (const ln of lines) {
    lineStart.push(acc);
    acc += ln.length + 1;
  }
  const pageMap = buildPageMap(opts.pages, lines);
  const explicit = detectExplicit(lines);
  const caps = detectCaps(lines, pageMap);
  const numbered = explicit.length === 0 ? detectNumbered(lines, lineStart) : [];
  const marks =
    explicit.length > 0
      ? mergeMarks(explicit, caps)
      : numbered.length > 0
        ? mergeMarks(numbered, caps)
        : caps.length > 0
          ? caps
          : pageStructureMarks(opts.pages, pageMap);
  if (marks.length === 0) {
    throw new Error(
      "NO_CHAPTER_MARKERS: no chapter markers detected — check the PDF extraction. " +
        "Tried: 'Chapter/Ch./Part + numeral' (arabic, roman, spelled out), numbered '1. Title' runs, " +
        "ALL-CAPS short lines, and blank chapter-title pages (page-structure fallback). " +
        "Remediation: OCR scanned PDFs, or write workdir/raw_chapters.json + raw_full.txt manually and continue from the `segment` stage.",
    );
  }
  marks.sort((a, b) => a.line - b.line);
  return marks.map((m, i) => {
    const start = lineStart[m.line];
    const end = i + 1 < marks.length ? lineStart[marks[i + 1].line] : fullText.length;
    return {
      id: `raw_ch_${i + 1}`,
      title: m.title,
      text: fullText.slice(start, end).trim(),
      char_start: start,
      char_end: end,
      marker_type: m.type,
    };
  });
}

function mergeMarks(primary: Mark[], secondary: Mark[]): Mark[] {
  const byLine = new Map<number, Mark>();
  for (const m of secondary) byLine.set(m.line, m); // primary marks win on the same line
  for (const m of primary) byLine.set(m.line, m);
  return [...byLine.values()];
}
