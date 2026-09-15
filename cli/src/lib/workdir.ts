import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class CliError extends Error {
  constructor(
    public code: "MISSING_INPUT" | "VALIDATION" | "GATE_OPEN" | "ABORTED" | "CONFLICT",
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}

export function statePath(workdir: string, name: string): string {
  return join(workdir, name);
}

export function writeState(workdir: string, name: string, data: unknown): void {
  mkdirSync(workdir, { recursive: true });
  writeFileSync(statePath(workdir, name), JSON.stringify(data, null, 2));
}

export function readState<T>(workdir: string, name: string): T {
  const p = statePath(workdir, name);
  if (!existsSync(p)) {
    throw new CliError("MISSING_INPUT", `missing required state file: ${name} (run the earlier stage first)`);
  }
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    throw new CliError("VALIDATION", `corrupt state file (not JSON): ${name} (restore or re-run the stage)`);
  }
}

export function exitCode(e: unknown): number {
  if (!(e instanceof CliError)) return 1;
  switch (e.code) {
    case "VALIDATION":
      return 2;
    case "MISSING_INPUT":
      return 3;
    case "GATE_OPEN":
    case "ABORTED":
      return 4;
    case "CONFLICT":
      return 5;
  }
}
