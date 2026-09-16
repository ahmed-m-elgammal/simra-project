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

export type RevenueEventAction = "grant" | "revoke" | "none";

export interface RevenueEventRecord {
  eventId: string;
  appUserId: string;
  bookId: string;
  type: string;
}

export interface AccountRecord {
  appUserId: string;
  email: string | null;
}

export interface BackupRecord {
  appUserId: string;
  blob: unknown;
  blobVersion: number;
}

export interface FakeDbOptions {
  books?: readonly BookRecord[];
  claims?: readonly { appUserId: string; bookId: string }[];
  entitlements?: readonly { appUserId: string; bookId: string }[];
  revenueEvents?: readonly RevenueEventRecord[];
  accounts?: readonly AccountRecord[];
  backups?: readonly BackupRecord[];
  requests?: readonly { appUserId: string; title: string; createdAt: Date }[];
  devices?: readonly { token: string; appUserId: string; platform: string; locale: string }[];
}

export interface Db {
  getFlags(): Promise<Record<string, unknown>>;
  listBooks(): Promise<readonly BookRecord[]>;
  getBook(bookId: string): Promise<BookRecord | null>;
  checkAccess(appUserId: string, bookIds: readonly string[]): Promise<AccessRecord>;
  claimFree(appUserId: string, bookId: string, options?: { enforceLimit?: boolean }): Promise<ClaimFreeResult>;
  recordRevenueEvent(event: RevenueEventRecord): Promise<{ inserted: boolean }>;
  upsertEntitlement(appUserId: string, bookId: string, source?: string): Promise<void>;
  deleteEntitlement(appUserId: string, bookId: string): Promise<void>;
  /**
   * Records the idempotency marker and applies the grant/revoke in ONE
   * transaction (security-definer RPC on Supabase). Replays (duplicate
   * event_id) return { inserted: false } and never re-apply, so a failed
   * apply can always be retried safely by RevenueCat.
   */
  applyRevenueEvent(event: RevenueEventRecord, action: RevenueEventAction): Promise<{ inserted: boolean }>;

  // Account
  getAccount(appUserId: string): Promise<AccountRecord | null>;
  findAccountByEmail(email: string): Promise<AccountRecord | null>;
  upsertAccount(appUserId: string, email?: string): Promise<void>;
  getPreservedCounts(appUserId: string): Promise<{ claims: number; entitlements: number }>;

  // Backup
  getBackup(appUserId: string): Promise<BackupRecord | null>;
  upsertBackup(appUserId: string, blob: unknown, blobVersion: number): Promise<void>;

  // Requests
  isPremium(appUserId: string): Promise<boolean>;
  countRecentRequests(appUserId: string, windowSeconds: number): Promise<number>;
  createRequest(appUserId: string, title: string): Promise<void>;

  // Devices
  registerDevice(appUserId: string, platform: string, token: string, locale?: string): Promise<void>;
  unregisterDevice(token: string): Promise<void>;
}
