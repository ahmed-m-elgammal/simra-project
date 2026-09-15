import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalizeChapter } from "./normalize.js";

const dir = dirname(fileURLToPath(import.meta.url));
const load = (n: string) => JSON.parse(readFileSync(join(dir, "..", "fixtures", n), "utf8"));

describe("normalizeChapter", () => {
  it("pivots effects arrays to byPersona maps and preserves order", () => {
    const ch = load("habits-ch1.canonical.json");
    const n = normalizeChapter(ch);
    expect(n.decisionIds).toEqual(ch.decisions.map((d: any) => d.id));
    const oid = ch.decisions[0].options[0].id;
    expect(Object.keys(n.optionsById[oid].effectsByPersona).sort()).toEqual(["maya", "omar"]);
    expect(n.optionsById[oid].effectsByPersona.maya.delta).toEqual(
      ch.decisions[0].options[0].persona_effects.find((e: any) => e.persona_id === "maya").delta,
    );
  });
});
