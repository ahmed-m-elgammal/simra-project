import { defineCommand } from "citty";
import { CliError } from "../lib/workdir.js";

export default defineCommand({
  meta: { name: "init", description: "Scaffold a book workdir. (Full command lands in Plan 02 Task 2.)" },
  run() {
    throw new CliError("ABORTED", "init is not implemented yet");
  },
});
