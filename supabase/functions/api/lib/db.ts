export type BookStatus = "draft" | "published";

export interface BookRecord {
  id: string;
  title: string;
  description: string;
  status: BookStatus;
  bundle_version: number;
  bundle_url: string;
}

export interface AccessRecord {
  claimedBookIds: readonly string[];
  entitledBookIds: readonly string[];
  freeClaimCount: number;
}

export type ClaimFreeResult =
  | { status: "claimed"; alreadyClaimed: boolean; remaining: number }
  | { status: "limit_reached"; remaining: 0 }
  | { status: "not_found" };

export interface FakeDbOptions {
  books?: readonly BookRecord[];
  claims?: readonly { appUserId: string; bookId: string }[];
  entitlements?: readonly { appUserId: string; bookId: string }[];
}

export interface Db {
  getFlags(): Promise<Record<string, unknown>>;
  listBooks(): Promise<readonly BookRecord[]>;
  getBook(bookId: string): Promise<BookRecord | null>;
  checkAccess(appUserId: string, bookIds: readonly string[]): Promise<AccessRecord>;
  claimFree(appUserId: string, bookId: string, options?: { enforceLimit?: boolean }): Promise<ClaimFreeResult>;
}

export class FakeDb implements Db {
  private readonly flags: Record<string, unknown>;
  private readonly books: BookRecord[];
  private readonly claims = new Set<string>();
  private readonly entitlements = new Set<string>();
  listBooksCalls = 0;
  checkAccessCalls = 0;

  constructor(flags: Record<string, unknown> = {}, options: FakeDbOptions = {}) {
    this.flags = { ...flags };
    this.books = [...(options.books ?? [])];
    for (const claim of options.claims ?? []) this.claims.add(this.key(claim.appUserId, claim.bookId));
    for (const entitlement of options.entitlements ?? []) {
      this.entitlements.add(this.key(entitlement.appUserId, entitlement.bookId));
    }
  }

  private key(appUserId: string, bookId: string): string {
    return `${appUserId}\u0000${bookId}`;
  }

  async getFlags(): Promise<Record<string, unknown>> {
    return { ...this.flags };
  }

  async listBooks(): Promise<readonly BookRecord[]> {
    this.listBooksCalls += 1;
    return this.books.filter((book) => book.status === "published").map((book) => ({ ...book }));
  }

  async getBook(bookId: string): Promise<BookRecord | null> {
    const book = this.books.find((candidate) => candidate.id === bookId);
    return book ? { ...book } : null;
  }

  async checkAccess(appUserId: string, bookIds: readonly string[]): Promise<AccessRecord> {
    this.checkAccessCalls += 1;
    const requested = new Set(bookIds);
    const claimedBookIds: string[] = [];
    const entitledBookIds: string[] = [];
    for (const key of this.claims) {
      const separator = key.indexOf("\u0000");
      if (key.slice(0, separator) === appUserId) {
        const bookId = key.slice(separator + 1);
        if (requested.has(bookId)) claimedBookIds.push(bookId);
      }
    }
    for (const bookId of bookIds) {
      if (this.entitlements.has(this.key(appUserId, bookId)) || this.entitlements.has(this.key(appUserId, "*"))) {
        entitledBookIds.push(bookId);
      }
    }
    return {
      claimedBookIds,
      entitledBookIds,
      freeClaimCount: [...this.claims].filter((key) => key.startsWith(`${appUserId}\u0000`)).length,
    };
  }

  async claimFree(appUserId: string, bookId: string, options: { enforceLimit?: boolean } = {}): Promise<ClaimFreeResult> {
    if (!this.books.some((book) => book.id === bookId && book.status === "published")) return { status: "not_found" };
    const key = this.key(appUserId, bookId);
    const claimCount = [...this.claims].filter((claim) => claim.startsWith(`${appUserId}\u0000`)).length;
    if (this.claims.has(key)) {
      return { status: "claimed", alreadyClaimed: true, remaining: Math.max(0, 3 - claimCount) };
    }
    if (options.enforceLimit !== false && claimCount >= 3) return { status: "limit_reached", remaining: 0 };
    this.claims.add(key);
    return { status: "claimed", alreadyClaimed: false, remaining: Math.max(0, 3 - claimCount - 1) };
  }

  hasClaim(appUserId: string, bookId: string): boolean {
    return this.claims.has(this.key(appUserId, bookId));
  }
}

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
    return response.json();
  }
}
