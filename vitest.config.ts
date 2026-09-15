import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["builder/src/**/*.test.ts", "cli/src/**/*.test.ts", "mobile/src/**/*.test.ts"] },
});
