import { z } from "zod";

/**
 * Backup blob schema for cloud state persistence.
 *
 * Structure: { version: 1, books: [{ book_id, bundle_version, state,
 * chapter_pointer, furthest_chapter, path_log_per_chapter }] }.
 *
 * path_log_per_chapter preserves recap history (decision + option indexes
 * per completed chapter), not just current-state numbers.
 */

export const BackupBookSchema = z.object({
  book_id: z.string().min(1),
  bundle_version: z.number().int().nonnegative(),
  state: z.record(z.string(), z.unknown()),
  chapter_pointer: z.union([z.number().int(), z.string()]),
  furthest_chapter: z.number().int().nonnegative(),
  path_log_per_chapter: z.union([
    z.record(z.string(), z.array(z.unknown())),
    z.array(z.unknown()),
  ]),
});

export const BackupBlobSchema = z.object({
  version: z.number().int().positive(),
  books: z.array(BackupBookSchema),
});

export type BackupBlob = z.infer<typeof BackupBlobSchema>;
export type BackupBook = z.infer<typeof BackupBookSchema>;

/** 1 MB serialized cap for backup blobs. */
export const MAX_BLOB_BYTES = 1_048_576;

/** Returns true when the raw serialized blob fits within the 1 MB cap. */
export function isWithinBlobCap(raw: string | Uint8Array): boolean {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
  return bytes <= MAX_BLOB_BYTES;
}
