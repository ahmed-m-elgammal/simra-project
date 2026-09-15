import { defineCommand, runMain } from "citty";
import { CliError, exitCode } from "./lib/workdir.js";

const main = defineCommand({
  meta: { name: "bookforge", version: "0.1.0", description: "Raw book in, client-ready bundle out. Agent-driven: no LLM API." },
  subCommands: {
    init: () => import("./commands/init.js").then((m) => m.default),
    ingest: () => import("./commands/ingest.js").then((m) => m.default),
    segment: () => import("./commands/segment.js").then((m) => m.default),
    personas: () => import("./commands/personas.js").then((m) => m.default),
    chapter: () => import("./commands/chapter.js").then((m) => m.default),
    bands: () => import("./commands/bands.js").then((m) => m.default),
    validate: () => import("./commands/validate.js").then((m) => m.default),
    build: () => import("./commands/build.js").then((m) => m.default),
    publish: () => import("./commands/publish.js").then((m) => m.default),
  },
  run() {
    if (process.stdout.isTTY === false) {
      console.log(JSON.stringify({ ok: false, code: "ABORTED", message: "no subcommand given" }));
      process.exitCode = 4;
    }
  },
});

try {
  await runMain(main);
} catch (e) {
  if (e instanceof CliError) {
    console.log(JSON.stringify({ ok: false, code: e.code, message: e.message, details: e.details }));
    process.exitCode = exitCode(e);
  } else {
    throw e;
  }
}
