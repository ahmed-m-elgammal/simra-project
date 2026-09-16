import type {
  AccessRecord,
  AccountRecord,
  BackupRecord,
  BookRecord,
  ClaimFreeResult,
  Db,
  FakeDbOptions,
  RevenueEventAction,
  RevenueEventRecord,
} from "./db-types.ts";

export class FakeDb implements Db {
  private readonly flags: Record<string, unknown>;
  private readonly books: BookRecord[];
  private readonly claims = new Set<string>();
  private readonly entitlements = new Set<string>();
  private readonly revenueEvents = new Map<string, RevenueEventRecord>();
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly backups = new Map<string, BackupRecord>();
  private readonly requests: Array<{ appUserId: string; title: string; createdAt: Date }> = [];
  private readonly devices = new Map<string, { token: string; appUserId: string; platform: string; locale: string }>();
  listBooksCalls = 0;
  checkAccessCalls = 0;

  constructor(flags: Record<string, unknown> = {}, options: FakeDbOptions = {}) {
    this.flags = { ...flags };
    this.books = [...(options.books ?? [])];
    for (const claim of options.claims ?? []) this.claims.add(this.key(claim.appUserId, claim.bookId));
    for (const ent of options.entitlements ?? []) this.entitlements.add(this.key(ent.appUserId, ent.bookId));
    for (const ev of options.revenueEvents ?? []) this.revenueEvents.set(ev.eventId, { ...ev });
    for (const acc of options.accounts ?? []) this.accounts.set(acc.appUserId, { ...acc });
    for (const bak of options.backups ?? []) this.backups.set(bak.appUserId, { ...bak });
    for (const req of options.requests ?? []) this.requests.push({ ...req });
    for (const dev of options.devices ?? []) this.devices.set(dev.token, { ...dev });
  }

  private key(a: string, b: string): string { return `${a}\u0000${b}`; }

  async getFlags(): Promise<Record<string, unknown>> { return { ...this.flags }; }

  async listBooks(): Promise<readonly BookRecord[]> {
    this.listBooksCalls += 1;
    return this.books.filter((b) => b.status === "published").map((b) => ({ ...b }));
  }

  async getBook(bookId: string): Promise<BookRecord | null> {
    const b = this.books.find((c) => c.id === bookId);
    return b ? { ...b } : null;
  }

  async checkAccess(appUserId: string, bookIds: readonly string[]): Promise<AccessRecord> {
    this.checkAccessCalls += 1;
    const requested = new Set(bookIds);
    const claimedBookIds: string[] = [];
    const entitledBookIds: string[] = [];
    for (const k of this.claims) {
      const sep = k.indexOf("\u0000");
      if (k.slice(0, sep) === appUserId) {
        const bid = k.slice(sep + 1);
        if (requested.has(bid)) claimedBookIds.push(bid);
      }
    }
    for (const bid of bookIds) {
      if (this.entitlements.has(this.key(appUserId, bid)) || this.entitlements.has(this.key(appUserId, "*"))) {
        entitledBookIds.push(bid);
      }
    }
    return {
      claimedBookIds,
      entitledBookIds,
      freeClaimCount: [...this.claims].filter((k) => k.startsWith(`${appUserId}\u0000`)).length,
    };
  }

  async claimFree(appUserId: string, bookId: string, options: { enforceLimit?: boolean } = {}): Promise<ClaimFreeResult> {
    if (!this.books.some((b) => b.id === bookId && b.status === "published")) return { status: "not_found" };
    const k = this.key(appUserId, bookId);
    const cnt = [...this.claims].filter((c) => c.startsWith(`${appUserId}\u0000`)).length;
    if (this.claims.has(k)) return { status: "claimed", alreadyClaimed: true, remaining: Math.max(0, 3 - cnt) };
    if (options.enforceLimit !== false && cnt >= 3) return { status: "limit_reached", remaining: 0 };
    this.claims.add(k);
    return { status: "claimed", alreadyClaimed: false, remaining: Math.max(0, 3 - cnt - 1) };
  }

  async recordRevenueEvent(event: RevenueEventRecord): Promise<{ inserted: boolean }> {
    if (this.revenueEvents.has(event.eventId)) return { inserted: false };
    this.revenueEvents.set(event.eventId, { ...event });
    return { inserted: true };
  }

  async upsertEntitlement(appUserId: string, bookId: string, _source = "revenuecat"): Promise<void> {
    this.entitlements.add(this.key(appUserId, bookId));
  }

  async deleteEntitlement(appUserId: string, bookId: string): Promise<void> {
    this.entitlements.delete(this.key(appUserId, bookId));
  }

  // Single in-memory step: marker + apply are trivially atomic on the fake.
  async applyRevenueEvent(event: RevenueEventRecord, action: RevenueEventAction): Promise<{ inserted: boolean }> {
    if (this.revenueEvents.has(event.eventId)) return { inserted: false };
    this.revenueEvents.set(event.eventId, { ...event });
    if (action === "grant") this.entitlements.add(this.key(event.appUserId, event.bookId));
    else if (action === "revoke") this.entitlements.delete(this.key(event.appUserId, event.bookId));
    return { inserted: true };
  }

  // --- Account ---
  async getAccount(appUserId: string): Promise<AccountRecord | null> {
    return this.accounts.get(appUserId) ?? null;
  }

  async findAccountByEmail(email: string): Promise<AccountRecord | null> {
    for (const acc of this.accounts.values()) {
      if (acc.email === email) return acc;
    }
    return null;
  }

  async upsertAccount(appUserId: string, email?: string): Promise<void> {
    this.accounts.set(appUserId, { appUserId, email: email ?? null });
  }

  async getPreservedCounts(appUserId: string): Promise<{ claims: number; entitlements: number }> {
    const claims = [...this.claims].filter((c) => c.startsWith(`${appUserId}\u0000`)).length;
    const entitlements = [...this.entitlements].filter((c) => c.startsWith(`${appUserId}\u0000`)).length;
    return { claims, entitlements };
  }

  // --- Backup ---
  async getBackup(appUserId: string): Promise<BackupRecord | null> {
    return this.backups.get(appUserId) ?? null;
  }

  async upsertBackup(appUserId: string, blob: unknown, blobVersion: number): Promise<void> {
    this.backups.set(appUserId, { appUserId, blob, blobVersion });
  }

  // --- Requests ---
  async isPremium(appUserId: string): Promise<boolean> {
    if (this.entitlements.has(this.key(appUserId, "*"))) return true;
    return this.accounts.has(appUserId);
  }

  async countRecentRequests(appUserId: string, windowSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - windowSeconds * 1000);
    return this.requests.filter((r) => r.appUserId === appUserId && r.createdAt >= cutoff).length;
  }

  async createRequest(appUserId: string, title: string): Promise<void> {
    this.requests.push({ appUserId, title, createdAt: new Date() });
  }

  // --- Devices ---
  async registerDevice(appUserId: string, platform: string, token: string, locale?: string): Promise<void> {
    this.devices.set(token, { token, appUserId, platform, locale: locale ?? "en" });
  }

  async unregisterDevice(token: string): Promise<void> {
    this.devices.delete(token);
  }

  // Inspection helpers for tests
  hasClaim(a: string, b: string): boolean { return this.claims.has(this.key(a, b)); }
  hasEntitlement(a: string, b: string): boolean { return this.entitlements.has(this.key(a, b)); }
  hasRevenueEvent(id: string): boolean { return this.revenueEvents.has(id); }
  hasDevice(token: string): boolean { return this.devices.has(token); }
  getRequestCount(): number { return this.requests.length; }
}
