import { defineCommand } from "citty";
import { CliError } from "../lib/workdir.js";

export default defineCommand({
  meta: { name: "build", description: "Compile the deterministic bundle. (Full command lands in Plan 02 Task 5.)" },
  run() {
    throw new CliError("ABORTED", "build is not implemented yet");
  },
});
