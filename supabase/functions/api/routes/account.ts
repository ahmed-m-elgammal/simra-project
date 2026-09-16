import type { Hono } from "jsr:@hono/hono";
import type { Variables } from "../index.ts";
import { BackupBlobSchema, isWithinBlobCap } from "../../../../builder/src/blob.ts";

export function registerAccountRoute(api: Hono<{ Variables: Variables }>) {
  api.post("/account", async (c) => {
    const uid = c.get("uid");
    const { db } = c.get("ctx");
    let body: { email?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // Body is optional or empty
    }
    const email = typeof body.email === "string" ? body.email.trim() : undefined;
    if (email) {
      const existing = await db.findAccountByEmail(email);
      if (existing && existing.appUserId !== uid) {
        return c.json({ ok: false, error: { code: "CONFLICT", message: "Email registered to another user" } }, 409);
      }
    }
    await db.upsertAccount(uid, email);
    const preserved = await db.getPreservedCounts(uid);
    return c.json({ ok: true, preserved });
  });

  api.post("/account/backup", async (c) => {
    const uid = c.get("uid");
    const { db } = c.get("ctx");
    const raw = await c.req.text();
    if (!isWithinBlobCap(raw)) {
      return c.json({ ok: false, error: { code: "INVALID", message: "Backup blob exceeds 1MB cap" } }, 400);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: { code: "INVALID", message: "Invalid JSON" } }, 400);
    }
    const result = BackupBlobSchema.safeParse(parsed);
    if (!result.success) {
      return c.json({ ok: false, error: { code: "INVALID", message: "Invalid backup schema" } }, 400);
    }
    await db.upsertBackup(uid, result.data, result.data.version);
    return c.json({ ok: true });
  });

  api.get("/account/backup", async (c) => {
    const uid = c.get("uid");
    const { db } = c.get("ctx");
    const backup = await db.getBackup(uid);
    if (!backup) {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "No backup exists" } }, 404);
    }
    const maxVersionParam = c.req.query("max_version");
    if (maxVersionParam !== undefined) {
      const maxVersion = Number(maxVersionParam);
      if (!Number.isNaN(maxVersion) && backup.blobVersion > maxVersion) {
        return c.json({ ok: false, error: { code: "INVALID", message: "Backup version exceeds supported version" } }, 412);
      }
    }
    const versions: Record<string, number> = {};
    const blobObj = backup.blob as { books?: Array<{ book_id?: string; bundle_version?: number }> };
    if (Array.isArray(blobObj?.books)) {
      for (const b of blobObj.books) {
        if (b && typeof b.book_id === "string" && typeof b.bundle_version === "number") {
          versions[b.book_id] = b.bundle_version;
        }
      }
    }
    return c.json({ ok: true, blob: backup.blob, versions });
  });
}
