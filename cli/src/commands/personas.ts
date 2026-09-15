import { defineCommand } from "citty";
import { CliError } from "../lib/workdir.js";

export default defineCommand({
  meta: { name: "personas", description: "Persona prompt/submit. (Full command lands in Plan 02 Task 4.)" },
  run() {
    throw new CliError("ABORTED", "personas is not implemented yet");
  },
});
