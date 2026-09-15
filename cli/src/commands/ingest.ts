import { defineCommand } from "citty";
import { CliError } from "../lib/workdir.js";

export default defineCommand({
  meta: { name: "ingest", description: "Extract PDF text and split chapters. (Full command lands in Plan 02 Task 2.)" },
  run() {
    throw new CliError("ABORTED", "ingest is not implemented yet");
  },
});
