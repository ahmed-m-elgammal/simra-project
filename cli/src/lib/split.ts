export interface RawChapter {
  id: string;
  title: string;
  text: string;
  char_start: number;
  char_end: number;
  marker_type: "regex" | "fallback";
}

const MARKER = /^(chapter|ch\.?|part)\s+\d+.*$/i;

export function splitChapters(fullText: string): RawChapter[] {
  const lines = fullText.split("\n");
  const marks: Array<{ line: number; title: string; type: "regex" | "fallback" }> = [];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (MARKER.test(t)) {
      marks.push({ line: i, title: t, type: "regex" });
    } else if (t.length > 0 && t.length < 60 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
      marks.push({ line: i, title: t, type: "fallback" });
    }
  });
  if (marks.length === 0) {
    throw new Error("NO_CHAPTER_MARKERS: no chapter markers detected — check the PDF extraction");
  }
  let cursor = 0;
  return marks.map((m, i) => {
    const start = fullText.indexOf(lines[m.line], cursor);
    const nextStart = i + 1 < marks.length ? fullText.indexOf(lines[marks[i + 1].line], start + 1) : fullText.length;
    const end = nextStart === -1 ? fullText.length : nextStart;
    cursor = end;
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
