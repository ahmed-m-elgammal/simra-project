import type {
  AccessRecord,
  BookRecord,
  ClaimFreeResult,
  Db,
  RevenueEventRecord,
} from "./db-types.ts";

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
  private readonly env: Record<string, string>;
  private readonly fetcher: typeof fetch;

  constructor(options: SupabaseDbOptions = {}) {
    this.env = options.env ?? environment();
    this.fetcher = options.fetcher ?? fetch;
  }

  async getFlags(): Promise<Record<string, unknown>> {
    const rows = await this.getJson("/rest/v1/flags?select=key,value", "flags query");
    if (!Array.isArray(rows)) throw new Error("flags query returned an invalid response");
    const flags: Record<string, unknown> = {};
    for (const row of rows) {
      if (row === null || typeof row !== "object" || typeof (row as { key?: unknown }).key !== "string" || !("value" in row)) {
        throw new Error("flags query returned an invalid row");
      }
      flags[(row as { key: string }).key] = (row as { value: unknown }).value;
    }
    return flags;
  }

  async listBooks(): Promise<readonly BookRecord[]> {
    const rows = await this.getJson("/rest/v1/books?select=id,title,description,status,bundle_version,bundle_url&status=eq.published&order=id.asc", "books query");
    if (!Array.isArray(rows)) throw new Error("books query returned an invalid response");
    return rows.map((row) => this.parseBook(row, "books query"));
  }

  async getBook(bookId: string): Promise<BookRecord | null> {
    const rows = await this.getJson(`/rest/v1/books?select=id,title,description,status,bundle_version,bundle_url&id=eq.${encodeURIComponent(bookId)}`, "book query");
    if (!Array.isArray(rows)) throw new Error("book query returned an invalid response");
    return rows.length === 0 ? null : this.parseBook(rows[0], "book query");
  }

  async checkAccess(appUserId: string, bookIds: readonly string[]): Promise<AccessRecord> {
    const user = encodeURIComponent(appUserId);
    const [claims, entitlements] = await Promise.all([
      this.getJson(`/rest/v1/free_claims?select=book_id&app_user_id=eq.${user}`, "free claims query"),
      this.getJson(`/rest/v1/entitlements?select=book_id&app_user_id=eq.${user}`, "entitlements query"),
    ]);
    if (!Array.isArray(claims) || !Array.isArray(entitlements)) throw new Error("access query returned an invalid response");
    const requested = new Set(bookIds);
    const claimedBookIds = claims.map((row) => this.bookId(row, "free claims")).filter((bookId) => requested.has(bookId));
    const entitledBookIds = entitlements.map((row) => this.bookId(row, "entitlements"));
    const entitled = new Set(entitledBookIds);
    return {
      claimedBookIds,
      entitledBookIds: bookIds.filter((bookId) => entitled.has(bookId) || entitled.has("*")),
      freeClaimCount: claims.length,
    };
  }

  async claimFree(appUserId: string, bookId: string, options: { enforceLimit?: boolean } = {}): Promise<ClaimFreeResult> {
    const result = await this.getJson("/rest/v1/rpc/claim_free", "free claim transaction", {
      method: "POST",
      body: JSON.stringify({
        p_app_user_id: appUserId,
        p_book_id: bookId,
        p_enforce_limit: options.enforceLimit !== false,
      }),
    });
    if (result === null || typeof result !== "object") throw new Error("free claim transaction returned an invalid response");
    const value = result as Record<string, unknown>;
    if (value.status === "not_found") return { status: "not_found" };
    if (value.status === "limit_reached" && value.remaining === 0) return { status: "limit_reached", remaining: 0 };
    if (value.status === "claimed" && typeof value.already_claimed === "boolean" && typeof value.remaining === "number" && Number.isInteger(value.remaining)) {
      return { status: "claimed", alreadyClaimed: value.already_claimed, remaining: value.remaining };
    }
    throw new Error("free claim transaction returned an invalid result");
  }

  async recordRevenueEvent(event: RevenueEventRecord): Promise<{ inserted: boolean }> {
    const result = await this.getJson("/rest/v1/revenue_events", "record revenue event", {
      method: "POST",
      headers: {
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify({
        event_id: event.eventId,
        app_user_id: event.appUserId,
        book_id: event.bookId,
        type: event.type,
      }),
    });
    if (!Array.isArray(result)) throw new Error("record revenue event returned an invalid response");
    return { inserted: result.length > 0 };
  }

  async upsertEntitlement(appUserId: string, bookId: string, source = "revenuecat"): Promise<void> {
    await this.getJson("/rest/v1/entitlements", "upsert entitlement", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        app_user_id: appUserId,
        book_id: bookId,
        source,
      }),
    });
  }

  async deleteEntitlement(appUserId: string, bookId: string): Promise<void> {
    const user = encodeURIComponent(appUserId);
    const book = encodeURIComponent(bookId).replace(/\*/g, "%2A");
    await this.getJson(`/rest/v1/entitlements?app_user_id=eq.${user}&book_id=eq.${book}`, "delete entitlement", {
      method: "DELETE",
      headers: {
        Prefer: "return=minimal",
      },
    });
  }

  private parseBook(row: unknown, source: string): BookRecord {
    if (row === null || typeof row !== "object") throw new Error(`${source} returned an invalid row`);
    const value = row as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.title !== "string" || typeof value.description !== "string" || (value.status !== "draft" && value.status !== "published") || typeof value.bundle_version !== "number" || !Number.isInteger(value.bundle_version) || typeof value.bundle_url !== "string") {
      throw new Error(`${source} returned an invalid row`);
    }
    return {
      id: value.id,
      title: value.title,
      description: value.description,
      status: value.status,
      bundle_version: value.bundle_version,
      bundle_url: value.bundle_url,
    };
  }

  private bookId(row: unknown, source: string): string {
    if (row === null || typeof row !== "object" || typeof (row as { book_id?: unknown }).book_id !== "string") {
      throw new Error(`${source} query returned an invalid row`);
    }
    return (row as { book_id: string }).book_id;
  }

  private async getJson(path: string, description: string, init: RequestInit = {}): Promise<unknown> {
    const baseUrl = this.env.SUPABASE_URL;
    const serviceRoleKey = this.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceRoleKey) throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    const response = await this.fetcher(new URL(path, baseUrl), {
      ...init,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`${description} failed with status ${response.status}`);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  }
}
