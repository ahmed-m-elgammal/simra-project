export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

interface Entry {
  value: string;
  expiresAtMs: number;
}

export class MemoryCache implements Cache {
  private readonly entries = new Map<string, Entry>();

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    if (!Number.isFinite(ttlSec) || ttlSec < 0) throw new Error("cache ttl must be a non-negative finite number");
    this.entries.set(key, { value, expiresAtMs: Date.now() + ttlSec * 1000 });
  }
}
