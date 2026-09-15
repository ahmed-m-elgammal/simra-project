import { defineCommand } from "citty";
import { CliError } from "../lib/workdir.js";

export default defineCommand({
  meta: { name: "bands", description: "Bands prompt/submit. (Full command lands in Plan 02 Task 4.)" },
  run() {
    throw new CliError("ABORTED", "bands is not implemented yet");
  },
});
