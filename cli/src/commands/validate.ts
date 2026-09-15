import { defineCommand } from "citty";
import { CliError } from "../lib/workdir.js";

export default defineCommand({
  meta: { name: "validate", description: "Validate the full workdir. (Full command lands in Plan 02 Task 5.)" },
  run() {
    throw new CliError("ABORTED", "validate is not implemented yet");
  },
});
