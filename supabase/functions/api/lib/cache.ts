export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

interface Entry {
  value: string;
  expiresAtMs: number;
}

export interface MemoryCacheOptions {
  /**
   * Hard ceiling on stored entries. The production cache is a module-level
   * singleton and its keys grow with the user base (`ent:{uid}:{bid}` access
   * decisions), so an unbounded map is a slow leak ending in isolate OOM
   * (review P2-4). Default 10_000 — access entries are tiny strings, so the
   * ceiling bounds the cache to a few megabytes.
   */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;

  constructor(options: MemoryCacheOptions = {}) {
    const max = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(max) || max < 1) throw new Error("memory cache maxEntries must be a positive integer");
    this.maxEntries = max;
  }

  /** Current entry count (live + not-yet-swept expired). Test observability. */
  get size(): number {
    return this.entries.size;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    // Re-insert to move the key to the MRU end: Map iteration order doubles
    // as the LRU order used by evict().
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    if (!Number.isFinite(ttlSec) || ttlSec < 0) throw new Error("cache ttl must be a non-negative finite number");
    this.entries.delete(key); // overwrite re-inserts at the MRU position
    this.entries.set(key, { value, expiresAtMs: Date.now() + ttlSec * 1000 });
    if (this.entries.size > this.maxEntries) this.evict();
  }

  // Runs only on overflow. Expired entries are garbage anyway, so they are
  // freed first (oldest order, stopping as soon as the cache fits again);
  // if every entry is still live, the least-recently-used ones are dropped.
  // Work per set is bounded by the cap, so no background sweeper is needed.
  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries) return;
      if (entry.expiresAtMs <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      this.entries.delete(oldest.value);
    }
  }
}
