export interface StorageAdapter {
  uploadImmutable(name: string, bytes: Uint8Array, contentType: string): Promise<string>;
  uploads(): string[];
}

export interface BookRow {
  version: number;
  bundle_url: string;
  sha: string;
}

export interface DbAdapter {
  getBook(book_id: string): Promise<BookRow | null>;
  setPublished(book_id: string, row: BookRow): Promise<void>;
}

export class FakeStorage implements StorageAdapter {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  readonly uploaded: string[] = [];

  async uploadImmutable(name: string, bytes: Uint8Array, contentType: string): Promise<string> {
    if (this.files.has(name)) throw new Error(`DUPLICATE: ${name} already exists (immutable)`);
    this.files.set(name, { bytes, contentType });
    this.uploaded.push(name);
    return `https://cdn.test/${name}`;
  }

  uploads(): string[] {
    return [...this.uploaded];
  }
}

export class FakeDb implements DbAdapter {
  readonly rows = new Map<string, BookRow>();

  async getBook(book_id: string): Promise<BookRow | null> {
    return this.rows.get(book_id) ?? null;
  }

  async setPublished(book_id: string, row: BookRow): Promise<void> {
    this.rows.set(book_id, row);
  }
}

export class SupabaseStorage implements StorageAdapter {
  private readonly uploadedNames: string[] = [];

  // Vendor client typed as any at the boundary: supabase-js carries its full
  // generated surface; this wrapper only touches storage.from().upload().
  constructor(
    private client: any,
    private bucket = "bundles",
  ) {}

  async uploadImmutable(name: string, bytes: Uint8Array, contentType: string): Promise<string> {
    const { error } = await this.client.storage.from(this.bucket).upload(name, bytes, {
      upsert: false,
      cacheControl: "public, max-age=31536000, immutable",
      contentType,
    });
    if (error) throw new Error(`UPLOAD_FAILED: ${error.message}`);
    this.uploadedNames.push(name);
    return name;
  }

  uploads(): string[] {
    return [...this.uploadedNames];
  }
}

export class SupabaseDb implements DbAdapter {
  // Same vendor-boundary rule as SupabaseStorage: any client, narrow use.
  constructor(private client: any) {}

  async getBook(book_id: string): Promise<BookRow | null> {
    const { data } = await this.client.from("books").select("bundle_version,bundle_url,bundle_sha").eq("id", book_id).maybeSingle();
    if (!data) return null;
    return { version: data.bundle_version ?? 0, bundle_url: data.bundle_url ?? "", sha: data.bundle_sha ?? "" };
  }

  async setPublished(book_id: string, row: BookRow): Promise<void> {
    const { error } = await this.client.from("books").upsert({ id: book_id, bundle_version: row.version, bundle_url: row.bundle_url, bundle_sha: row.sha, status: "published" });
    if (error) throw new Error(`DB_WRITE_FAILED: ${error.message}`);
  }
}
