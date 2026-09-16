import type {
  AccessRecord,
  AccountRecord,
  BackupRecord,
  BookRecord,
  ClaimFreeResult,
  Db,
  RevenueEventAction,
  RevenueEventRecord,
} from "./db-types.ts";
import { SupabaseClient } from "./supabase-client.ts";

function environment(): Record<string, string> {
  return {
    SUPABASE_URL: Deno.env.get("SUPABASE_URL") ?? "",
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  };
}

export interface SupabaseDbOptions {
  env?: Record<string, string>;
  fetcher?: typeof fetch;
}

export class SupabaseDb implements Db {
  private readonly client: SupabaseClient;

  constructor(options: SupabaseDbOptions = {}) {
    const env = options.env ?? environment();
    this.client = new SupabaseClient(env, options.fetcher ?? fetch);
  }

  async getFlags(): Promise<Record<string, unknown>> {
    const rows = await this.client.getJson("/rest/v1/flags?select=key,value", "flags query");
    if (!Array.isArray(rows)) throw new Error("flags query returned an invalid response");
    const flags: Record<string, unknown> = {};
    for (const row of rows) {
      if (row && typeof row === "object" && typeof (row as { key?: unknown }).key === "string" && "value" in row) {
        flags[(row as { key: string }).key] = (row as { value: unknown }).value;
      }
    }
    return flags;
  }

  async listBooks(): Promise<readonly BookRecord[]> {
    const rows = await this.client.getJson("/rest/v1/books?select=id,title,description,status,bundle_version,bundle_url&status=eq.published&order=id.asc", "books query");
    if (!Array.isArray(rows)) throw new Error("books query returned an invalid response");
    return rows.map((row) => this.client.parseBook(row, "books query"));
  }

  async getBook(bookId: string): Promise<BookRecord | null> {
    const rows = await this.client.getJson(`/rest/v1/books?select=id,title,description,status,bundle_version,bundle_url&id=eq.${encodeURIComponent(bookId)}`, "book query");
    if (!Array.isArray(rows)) throw new Error("book query returned an invalid response");
    return rows.length === 0 ? null : this.client.parseBook(rows[0], "book query");
  }

  async checkAccess(appUserId: string, bookIds: readonly string[]): Promise<AccessRecord> {
    const user = encodeURIComponent(appUserId);
    const [claims, entitlements] = await Promise.all([
      this.client.getJson(`/rest/v1/free_claims?select=book_id&app_user_id=eq.${user}`, "free claims query"),
      this.client.getJson(`/rest/v1/entitlements?select=book_id&app_user_id=eq.${user}`, "entitlements query"),
    ]);
    if (!Array.isArray(claims) || !Array.isArray(entitlements)) throw new Error("access query returned an invalid response");
    const requested = new Set(bookIds);
    const claimedBookIds = claims.map((r) => this.client.bookId(r, "free claims")).filter((b) => requested.has(b));
    const entitledBookIds = entitlements.map((r) => this.client.bookId(r, "entitlements"));
    const entitled = new Set(entitledBookIds);
    return {
      claimedBookIds,
      entitledBookIds: bookIds.filter((b) => entitled.has(b) || entitled.has("*")),
      freeClaimCount: claims.length,
    };
  }

  async claimFree(appUserId: string, bookId: string, options: { enforceLimit?: boolean } = {}): Promise<ClaimFreeResult> {
    const result = await this.client.getJson("/rest/v1/rpc/claim_free", "free claim transaction", {
      method: "POST",
      body: JSON.stringify({ p_app_user_id: appUserId, p_book_id: bookId, p_enforce_limit: options.enforceLimit !== false }),
    });
    if (result === null || typeof result !== "object") throw new Error("free claim transaction returned an invalid response");
    const val = result as Record<string, unknown>;
    if (val.status === "not_found") return { status: "not_found" };
    if (val.status === "limit_reached" && val.remaining === 0) return { status: "limit_reached", remaining: 0 };
    if (val.status === "claimed" && typeof val.already_claimed === "boolean" && typeof val.remaining === "number") {
      return { status: "claimed", alreadyClaimed: val.already_claimed, remaining: val.remaining };
    }
    throw new Error("free claim transaction returned an invalid result");
  }

  async recordRevenueEvent(event: RevenueEventRecord): Promise<{ inserted: boolean }> {
    const result = await this.client.getJson("/rest/v1/revenue_events", "record revenue event", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ event_id: event.eventId, app_user_id: event.appUserId, book_id: event.bookId, type: event.type }),
    });
    if (!Array.isArray(result)) throw new Error("record revenue event returned an invalid response");
    return { inserted: result.length > 0 };
  }

  async upsertEntitlement(appUserId: string, bookId: string, source = "revenuecat"): Promise<void> {
    await this.client.getJson("/rest/v1/entitlements", "upsert entitlement", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ app_user_id: appUserId, book_id: bookId, source }),
    });
  }

  async deleteEntitlement(appUserId: string, bookId: string): Promise<void> {
    const user = encodeURIComponent(appUserId);
    const book = encodeURIComponent(bookId).replace(/\*/g, "%2A");
    await this.client.getJson(`/rest/v1/entitlements?app_user_id=eq.${user}&book_id=eq.${book}`, "delete entitlement", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  async applyRevenueEvent(event: RevenueEventRecord, action: RevenueEventAction): Promise<{ inserted: boolean }> {
    const result = await this.client.getJson("/rest/v1/rpc/apply_revenue_event", "apply revenue event", {
      method: "POST",
      body: JSON.stringify({
        p_event_id: event.eventId,
        p_app_user_id: event.appUserId,
        p_book_id: event.bookId,
        p_type: event.type,
        p_action: action,
      }),
    });
    if (result === null || typeof result !== "object") throw new Error("apply revenue event returned an invalid response");
    const val = result as Record<string, unknown>;
    if (typeof val.inserted !== "boolean") throw new Error("apply revenue event returned an invalid result");
    return { inserted: val.inserted };
  }

  async getAccount(appUserId: string): Promise<AccountRecord | null> {
    const rows = await this.client.getJson(`/rest/v1/accounts?select=app_user_id,email&app_user_id=eq.${encodeURIComponent(appUserId)}`, "get account");
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return { appUserId: rows[0].app_user_id, email: rows[0].email ?? null };
  }

  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    const rows = await this.client.getJson(`/rest/v1/accounts?select=app_user_id,email&email=eq.${encodeURIComponent(email)}`, "find account by email");
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return { appUserId: rows[0].app_user_id, email: rows[0].email ?? null };
  }

  async upsertAccount(appUserId: string, email?: string): Promise<void> {
    await this.client.getJson("/rest/v1/accounts", "upsert account", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ app_user_id: appUserId, ...(email !== undefined ? { email } : {}) }),
    });
  }

  async getPreservedCounts(appUserId: string): Promise<{ claims: number; entitlements: number }> {
    const user = encodeURIComponent(appUserId);
    const [claims, entitlements] = await Promise.all([
      this.client.getJson(`/rest/v1/free_claims?select=book_id&app_user_id=eq.${user}`, "free claims count"),
      this.client.getJson(`/rest/v1/entitlements?select=book_id&app_user_id=eq.${user}`, "entitlements count"),
    ]);
    return {
      claims: Array.isArray(claims) ? claims.length : 0,
      entitlements: Array.isArray(entitlements) ? entitlements.length : 0,
    };
  }

  async getBackup(appUserId: string): Promise<BackupRecord | null> {
    const rows = await this.client.getJson(`/rest/v1/backups?select=app_user_id,blob,blob_version&app_user_id=eq.${encodeURIComponent(appUserId)}`, "get backup");
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return { appUserId: rows[0].app_user_id, blob: rows[0].blob, blobVersion: rows[0].blob_version };
  }

  async upsertBackup(appUserId: string, blob: unknown, blobVersion: number): Promise<void> {
    await this.client.getJson("/rest/v1/backups", "upsert backup", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ app_user_id: appUserId, blob, blob_version: blobVersion, updated_at: new Date().toISOString() }),
    });
  }

  async isPremium(appUserId: string): Promise<boolean> {
    const user = encodeURIComponent(appUserId);
    const [entitlements, accounts] = await Promise.all([
      this.client.getJson(`/rest/v1/entitlements?select=book_id&app_user_id=eq.${user}&book_id=eq.%2A`, "premium entitlements"),
      this.client.getJson(`/rest/v1/accounts?select=app_user_id&app_user_id=eq.${user}`, "account existence"),
    ]);
    return (Array.isArray(entitlements) && entitlements.length > 0) || (Array.isArray(accounts) && accounts.length > 0);
  }

  async countRecentRequests(appUserId: string, windowSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const rows = await this.client.getJson(
      `/rest/v1/requests?select=id&app_user_id=eq.${encodeURIComponent(appUserId)}&created_at=gte.${encodeURIComponent(cutoff)}`,
      "recent requests count",
    );
    return Array.isArray(rows) ? rows.length : 0;
  }

  async createRequest(appUserId: string, title: string): Promise<void> {
    await this.client.getJson("/rest/v1/requests", "create request", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ app_user_id: appUserId, title }),
    });
  }

  async registerDevice(appUserId: string, platform: string, token: string, locale = "en"): Promise<void> {
    await this.client.getJson("/rest/v1/devices", "register device", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ token, app_user_id: appUserId, platform, locale, updated_at: new Date().toISOString() }),
    });
  }

  async unregisterDevice(token: string): Promise<void> {
    await this.client.getJson(`/rest/v1/devices?token=eq.${encodeURIComponent(token)}`, "unregister device", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }
}
