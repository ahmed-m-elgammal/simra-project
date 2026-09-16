// Syntax + seeds + constraints gate for supabase/migrations + seed files.
// Runs on pg-mem (in-memory Postgres emulator): proves the SQL parses, the
// seeds apply, PKs/checks/FKs hold. It does NOT prove RLS deny-by-default
// (pg-mem skips RLS) — that check stays in e2e.local.sh on a real stack.
// RLS lines are stripped before execution and asserted present by grep below.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DataType, newDb } from "pg-mem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migration = ["001_core.sql", "002_api_catalog_claims.sql"]
  .map((name) => readFileSync(join(root, "supabase", "migrations", name), "utf8"))
  .join("\n");

// 1. Every data table must carry an RLS enable line (live deny proven on Docker).
const tables = ["books", "book_configs", "personas", "chapters", "decisions", "options", "entitlements", "free_claims", "devices", "progress", "requests", "revenue_events", "backups", "accounts"];
for (const t of tables) {
  if (!migration.includes(`alter table ${t} enable row level security`)) {
    throw new Error(`missing RLS line for ${t}`);
  }
}
if (/create policy/i.test(migration)) throw new Error("permissive policies forbidden: anon must get nothing");
if (!/pg_advisory_xact_lock\(hashtextextended\(p_app_user_id, 0\)\)/i.test(migration)) {
  throw new Error("claim_free must serialize claims per app user");
}

// pg-mem does not execute PL/pgSQL; validate the function's critical lock text
// above and execute the migration's relational DDL here.
const executableMigration = migration
  .replace(/create or replace function public\.claim_free[\s\S]*?\$\$;\s*/i, "")
  .replace(/^revoke all on function public\.claim_free.*$/gmi, "")
  .replace(/^grant execute on function public\.claim_free.*$/gmi, "")
  .replace(/^\s*;\s*$/gm, "");
const stripped = executableMigration
  .split("\n")
  .filter((l) => !l.includes("row level security"))
  .join("\n");

const db = newDb();
// pg-mem ships few native functions; register the one CHECK we use.
db.public.registerFunction({
  name: "char_length",
  args: [DataType.text],
  returns: DataType.integer,
  implementation: (s) => [...String(s)].length,
});
db.public.none(stripped);
db.public.none(readFileSync(join(root, "supabase", "seed", "minibook.sql"), "utf8"));
db.public.none(readFileSync(join(root, "supabase", "seed", "dev-users.sql"), "utf8"));

const one = (sql) => db.public.one(`select count(*)::int as n from (${sql}) t`).n;
const eq = (name, got, want) => {
  if (got !== want) throw new Error(`${name}: got ${got}, want ${want}`);
};
eq("books", one("select * from books"), 1);
if (db.public.one(`select description from books where id='habits'`).description !== "A short simulation about building habits.") {
  throw new Error("books.description seed is missing");
}
eq("options", one("select * from options"), 4);
eq("free_claims", one("select * from free_claims"), 3);
eq("u_fresh-free-claims", one("select * from free_claims where app_user_id='u_fresh'"), 0);
eq("u_fresh-entitlements", one("select * from entitlements where app_user_id='u_fresh'"), 0);
if (db.public.one(`select value from flags where key='payments_enabled'`).value !== false) {
  throw new Error("payments_enabled flag must default to JSON false");
}

// PK conflict must fail (idempotency relies on it).
let pkFailed = false;
try {
  db.public.none(`insert into free_claims (app_user_id, book_id) values ('u_free','a')`);
} catch {
  pkFailed = true;
}
if (!pkFailed) throw new Error("free_claims PK did not reject a duplicate");

// CHECK constraint must fail (devices platform).
let checkFailed = false;
try {
  db.public.none(`insert into devices (token, app_user_id, platform) values ('t','u','watch')`);
} catch {
  checkFailed = true;
}
if (!checkFailed) throw new Error("devices platform CHECK did not reject");

// FK cascade path exists (persona references seeded book).
eq("personas-of-habits", one(`select * from personas where book_id='habits'`), 2);

console.log("verify-sql: ALL GREEN (syntax + seeds + constraints; RLS text present, live deny on Docker)");
