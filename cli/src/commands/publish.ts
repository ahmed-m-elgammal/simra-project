import { defineCommand } from "citty";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { compile } from "@app/bundle-builder";
import { CliError, readState } from "../lib/workdir.js";
import { assembleBook } from "../lib/assemble.js";
import { FakeDb, FakeStorage, SupabaseDb, SupabaseStorage } from "../lib/adapters.js";
import type { DbAdapter, StorageAdapter } from "../lib/adapters.js";
import { runValidate } from "./validate.js";

export interface PublishOpts {
  dryRun?: boolean;
  embeddings?: "fake" | "local";
  storage?: StorageAdapter;
  db?: DbAdapter;
}

export interface PublishReport {
  ok: true;
  skipped?: string;
  version: number;
  url: string;
  sha: string;
}

function bundleVersion(file: string, prefix: string): number | undefined {
  const suffix = file.slice(prefix.length, -".json".length);
  if (!/^\d+$/.test(suffix)) return undefined;
  const version = Number(suffix);
  return Number.isSafeInteger(version) ? version : undefined;
}

export async function runPublish(workdir: string, opts: PublishOpts = {}): Promise<PublishReport> {
  await runValidate(workdir, { embeddings: opts.embeddings ?? "local" });
  const config = readState<{ book_id: string; locale: string; next_version: number }>(workdir, "bookforge.config.json");

  // Anchor on dist: the version to publish is the one build wrote, not next_version.
  const dist = join(workdir, "dist");
  const prefix = `bundle-${config.book_id}-${config.locale}-v`;
  const candidates = existsSync(dist)
    ? readdirSync(dist)
        .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
        .map((name) => ({ name, version: bundleVersion(name, prefix) }))
        .filter((candidate): candidate is { name: string; version: number } => candidate.version !== undefined)
    : [];
  if (candidates.length === 0) {
    throw new CliError("VALIDATION", "no built bundle in dist/: run `build` first");
  }
  const selected = candidates.sort((a, b) => a.version - b.version || a.name.localeCompare(b.name)).at(-1) as { name: string; version: number };
  const distName = selected.name;
  const distVersion = selected.version;
  const distBytes = readFileSync(join(dist, distName), "utf8");

  const book = assembleBook(workdir, distVersion);
  const fresh = compile({ ...book, config: { vars: book.config.vars, bands: book.config.bands } });
  if (distBytes !== fresh.json) {
    throw new CliError("VALIDATION", "dist is stale: run `build` again, then publish without changes");
  }

  const db = opts.db ?? new FakeDb();
  const row = await db.getBook(book.book_id);
  if (row && row.sha === fresh.sha) {
    return { ok: true, skipped: "identical", version: row.version, url: row.bundle_url, sha: row.sha };
  }
  const targetVersion = (row?.version ?? 0) + 1;
  if (distVersion !== targetVersion) {
    throw new CliError("VALIDATION", `dist is at v${distVersion} but the server is at v${row?.version ?? 0}: rebuild after remote changes`);
  }

  if (opts.dryRun === true) {
    return { ok: true, version: targetVersion, url: `(dry-run) ${distName}`, sha: fresh.sha };
  }

  const base = `bundle-${book.book_id}-${config.locale}-v${distVersion}`;
  const storage = opts.storage ?? new FakeStorage();
  const names = [`${base}.json`, `${base}.json.br`, `${base}.json.gz`] as const;
  const payloads: Array<[string, Uint8Array, string]> = [
    [names[0], new TextEncoder().encode(fresh.json), "application/json"],
    [names[1], fresh.br, "application/json"],
    [names[2], fresh.gz, "application/json"],
  ];
  try {
    for (const [name, bytes, type] of payloads) await storage.uploadImmutable(name, bytes, type);
  } catch (e: any) {
    if (String(e?.message ?? e).startsWith("DUPLICATE")) {
      const latest = await db.getBook(book.book_id);
      if (latest && latest.sha === fresh.sha) {
        return { ok: true, skipped: "identical", version: latest.version, url: latest.bundle_url, sha: latest.sha };
      }
      throw new CliError("CONFLICT", "version taken by different content: re-pull and rebuild");
    }
    throw e;
  }
  const url = `bundles/${names[0]}`;
  await db.setPublished(book.book_id, { version: targetVersion, bundle_url: url, sha: fresh.sha });
  return { ok: true, version: targetVersion, url, sha: fresh.sha };
}

function liveAdapters(): { storage: StorageAdapter; db: DbAdapter } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new CliError("MISSING_INPUT", "publish needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env");
  const client = createClient(url, key);
  return { storage: new SupabaseStorage(client), db: new SupabaseDb(client) };
}

export default defineCommand({
  meta: { name: "publish", description: "Dry-run and publish (upload immutable bundle, swap pointer)." },
  args: {
    workdir: { type: "string" as const, description: "Book workdir", required: true as const },
    format: { type: "string" as const, description: "Output format (human|json)", required: false as const },
    dryRun: { type: "boolean" as const, description: "Check everything, change nothing", required: false as const },
    embeddings: { type: "string" as const, description: "Embeddings provider (fake|local)", required: false as const },
  },
  async run({ args }) {
    const workdir = args.workdir as string;
    const flags = { dryRun: (args.dryRun as boolean | undefined) === true, embeddings: ((args.embeddings as string | undefined) ?? "local") as "fake" | "local" };
    const adapters = flags.dryRun ? {} : liveAdapters();
    const report = await runPublish(workdir, { ...flags, ...adapters });
    if (args.format === "json" || process.stdout.isTTY === false) console.log(JSON.stringify(report));
    else if (report.skipped) console.log(`Already published (identical): v${report.version}.`);
    else if (flags.dryRun) console.log(`Would publish v${report.version} (${report.sha.slice(0, 12)}…). Push cohort resolves server-side.`);
    else console.log(`Published v${report.version} → ${report.url}.`);
    return report;
  },
});
