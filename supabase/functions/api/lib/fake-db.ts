import type {
  AccessRecord,
  BookRecord,
  ClaimFreeResult,
  Db,
  FakeDbOptions,
  RevenueEventRecord,
} from "./db-types.ts";

export class FakeDb implements Db {
  private readonly flags: Record<string, unknown>;
  private readonly books: BookRecord[];
  private readonly claims = new Set<string>();
  private readonly entitlements = new Set<string>();
  private readonly revenueEvents = new Map<string, RevenueEventRecord>();
  listBooksCalls = 0;
  checkAccessCalls = 0;

  constructor(flags: Record<string, unknown> = {}, options: FakeDbOptions = {}) {
    this.flags = { ...flags };
    this.books = [...(options.books ?? [])];
    for (const claim of options.claims ?? []) this.claims.add(this.key(claim.appUserId, claim.bookId));
    for (const entitlement of options.entitlements ?? []) {
      this.entitlements.add(this.key(entitlement.appUserId, entitlement.bookId));
    }
    for (const event of options.revenueEvents ?? []) {
      this.revenueEvents.set(event.eventId, { ...event });
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

  async recordRevenueEvent(event: RevenueEventRecord): Promise<{ inserted: boolean }> {
    if (this.revenueEvents.has(event.eventId)) {
      return { inserted: false };
    }
    this.revenueEvents.set(event.eventId, { ...event });
    return { inserted: true };
  }

  async upsertEntitlement(appUserId: string, bookId: string, _source = "revenuecat"): Promise<void> {
    this.entitlements.add(this.key(appUserId, bookId));
  }

  async deleteEntitlement(appUserId: string, bookId: string): Promise<void> {
    this.entitlements.delete(this.key(appUserId, bookId));
  }

  hasClaim(appUserId: string, bookId: string): boolean {
    return this.claims.has(this.key(appUserId, bookId));
  }

  hasEntitlement(appUserId: string, bookId: string): boolean {
    return this.entitlements.has(this.key(appUserId, bookId));
  }

  hasRevenueEvent(eventId: string): boolean {
    return this.revenueEvents.has(eventId);
  }
}
