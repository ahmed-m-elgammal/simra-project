import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fxDir = dirname(fileURLToPath(import.meta.url));

// Full valid workdir: config + raw + approved sim/personas/chapters/bands.
export function seedFullWorkdir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bf-"));
  writeFileSync(
    join(dir, "bookforge.config.json"),
    JSON.stringify({ book_id: "mini", locale: "en", thresholds: { dupFlag: 0.85, dupNote: 0.7 }, pack_format: 1, next_version: 1 }),
  );
  for (const f of ["raw_chapters.json", "sim_chapters.json", "personas.json", "bands.json"]) {
    copyFileSync(join(fxDir, f), join(dir, f));
  }
  copyFileSync(join(fxDir, "sim_chapters.json"), join(dir, "sim_chapters.approved.json"));
  mkdirSync(join(dir, "chapters"), { recursive: true });
  copyFileSync(join(fxDir, "chapters", "01.json"), join(dir, "chapters", "01.approved.json"));
  copyFileSync(join(fxDir, "agent-chapter02-good.json"), join(dir, "chapters", "02.approved.json"));
  return dir;
}
