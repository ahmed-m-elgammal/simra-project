import { defineCommand } from "citty";
import { CliError } from "../lib/workdir.js";

export default defineCommand({
  meta: { name: "segment", description: "Segmentation prompt/submit/approve. (Full command lands in Plan 02 Task 4.)" },
  run() {
    throw new CliError("ABORTED", "segment is not implemented yet");
  },
});
