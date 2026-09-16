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

export interface RevenueEventRecord {
  eventId: string;
  appUserId: string;
  bookId: string;
  type: string;
}

export interface FakeDbOptions {
  books?: readonly BookRecord[];
  claims?: readonly { appUserId: string; bookId: string }[];
  entitlements?: readonly { appUserId: string; bookId: string }[];
  revenueEvents?: readonly RevenueEventRecord[];
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
}
