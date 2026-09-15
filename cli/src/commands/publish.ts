import { defineCommand } from "citty";
import { CliError } from "../lib/workdir.js";

export default defineCommand({
  meta: { name: "publish", description: "Dry-run and publish. (Full command lands in Plan 02 Task 6.)" },
  run() {
    throw new CliError("ABORTED", "publish is not implemented yet");
  },
});
