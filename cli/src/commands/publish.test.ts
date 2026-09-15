import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "citty";
import { CliError } from "../lib/workdir.js";
import { FakeDb, FakeStorage } from "../lib/adapters.js";
import { runPublish } from "./publish.js";
import build from "./build.js";
import { seedFullWorkdir } from "../../fixtures/minibook/seed-workdir.js";

describe("publish", () => {
  it("dry-run changes nothing", async () => {
    const dir = seedFullWorkdir();
    await runCommand(build, { rawArgs: ["--workdir", dir, "--embeddings", "fake"] });
    const db = new FakeDb();
    const storage = new FakeStorage();
    const report = await runPublish(dir, { dryRun: true, embeddings: "fake", db, storage });
    expect(report.ok).toBe(true);
    expect(report.version).toBe(1);
    expect(storage.uploads()).toEqual([]);
    expect((await db.getBook("mini"))).toBeNull();
  });
  it("publishes once, then skips identical content", async () => {
    const dir = seedFullWorkdir();
    await runCommand(build, { rawArgs: ["--workdir", dir, "--embeddings", "fake"] });
    const db = new FakeDb();
    const storage = new FakeStorage();
    const first = await runPublish(dir, { embeddings: "fake", db, storage });
    expect(first.version).toBe(1);
    expect(first.url).toContain("bundle-mini-en-v1.json");
    expect(storage.uploads()).toHaveLength(3);
    const row = await db.getBook("mini");
    expect(row?.sha).toBe(first.sha);
    const second = await runPublish(dir, { embeddings: "fake", db, storage });
    expect(second.skipped).toBe("identical");
    expect(storage.uploads()).toHaveLength(3);
  });
  it("refuses when dist is stale", async () => {
    const dir = seedFullWorkdir();
    await runCommand(build, { rawArgs: ["--workdir", dir, "--embeddings", "fake"] });
    writeFileSync(join(dir, "dist", "bundle-mini-en-v1.json"), "{}");
    try {
      await runPublish(dir, { embeddings: "fake", db: new FakeDb(), storage: new FakeStorage() });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe("VALIDATION");
    }
  });
  it("live command needs Supabase env", async () => {
    const dir = seedFullWorkdir();
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const { default: publish } = await import("./publish.js");
      await expect(runCommand(publish, { rawArgs: ["--workdir", dir, "--embeddings", "fake"] })).rejects.toThrow(/SUPABASE_URL/);
    } finally {
      if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
      if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    }
  });
});
