import type { BookRecord } from "./db-types.ts";

export class SupabaseClient {
  constructor(
    private readonly env: Record<string, string>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getJson(path: string, description: string, init: RequestInit = {}): Promise<unknown> {
    const baseUrl = this.env.SUPABASE_URL;
    const serviceRoleKey = this.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!baseUrl || !serviceRoleKey) {
      throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
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
    if (!response.ok) {
      throw new Error(`${description} failed with status ${response.status}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  parseBook(row: unknown, source: string): BookRecord {
    if (row === null || typeof row !== "object") throw new Error(`${source} returned an invalid row`);
    const value = row as Record<string, unknown>;
    if (
      typeof value.id !== "string" ||
      typeof value.title !== "string" ||
      typeof value.description !== "string" ||
      (value.status !== "draft" && value.status !== "published") ||
      typeof value.bundle_version !== "number" ||
      !Number.isInteger(value.bundle_version) ||
      typeof value.bundle_url !== "string"
    ) {
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

  bookId(row: unknown, source: string): string {
    if (row === null || typeof row !== "object" || typeof (row as { book_id?: unknown }).book_id !== "string") {
      throw new Error(`${source} query returned an invalid row`);
    }
    return (row as { book_id: string }).book_id;
  }
}
