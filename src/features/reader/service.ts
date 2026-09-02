import { db, type BookRecord } from '@/db/db';
import { track } from '@/features/analytics/analytics';
import { addBook, patchBook, softDeleteBook, isSyncing } from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';
import { deleteRemoteBookFile, downloadBookFileIfMissing, uploadBookFile } from './blobSync';
import { detectFormat, parseBook, type ParsedBook } from './parse';
import { saveBookFile, getBookFile, deleteBookFile, opfsAvailable } from './storage';

export type ImportResult = { record: BookRecord; book: ParsedBook };

// Only PDF is worth caching: its parse walks every page through pdf.js, unlike the cheap
// EPUB/FB2/DOCX parsers. Reuses the catalogCache store (keys never collide — UUID vs slug).
const parseCacheKey = (id: string) => `pdf:${id}`;

async function cacheParsed(id: string, book: ParsedBook): Promise<void> {
  try {
    await db.catalogCache.put({ id: parseCacheKey(id), book, cachedAt: Date.now() });
  } catch {
    // best-effort cache
  }
}

export async function importBook(file: File): Promise<ImportResult> {
  if (!opfsAvailable()) throw new Error('offline-storage-unavailable');
  const format = detectFormat(file.name);
  if (!format) throw new Error('unsupported-format');

  const book = await parseBook(file, format);
  const id = crypto.randomUUID();
  await saveBookFile(id, file);
  const record: BookRecord = {
    id,
    title: book.title,
    author: book.author,
    format,
    addedAt: Date.now(),
    chapterCount: book.chapters.length,
    lastChapter: 0,
  };
  await addBook(record);
  void uploadBookFile(id); // opt-in cloud copy (self-guards on the toggle + auth)
  if (format === 'pdf') await cacheParsed(id, book);
  return { record, book };
}

export async function listBooks(): Promise<BookRecord[]> {
  try {
    const all = await db.books.orderBy('addedAt').reverse().toArray();
    return all.filter((b) => !isDeleted(b)); // hide tombstones (soft-deleted, kept for sync propagation)
  } catch {
    return [];
  }
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  const b = await db.books.get(id);
  return b && !isDeleted(b) ? b : undefined; // a tombstoned book reads as gone
}

export async function openBook(record: BookRecord): Promise<ParsedBook> {
  if (record.format === 'pdf') {
    try {
      const hit = await db.catalogCache.get(parseCacheKey(record.id));
      if (hit) {
        void track('book_open', { source: 'imported', format: record.format });
        return hit.book as ParsedBook;
      }
    } catch {
      // cache unavailable — fall through to a fresh parse
    }
  }
  await downloadBookFileIfMissing(record.id); // fetch the cloud copy on a device that only has the metadata
  const file = await getBookFile(record.id);
  const parsed = await parseBook(file, record.format);
  if (record.format === 'pdf') await cacheParsed(record.id, parsed);
  void track('book_open', { source: 'imported', format: record.format });
  return parsed;
}

export async function removeBook(id: string): Promise<void> {
  await deleteBookFile(id);
  await deleteRemoteBookFile(id).catch(() => undefined); // release the cloud blob + its quota (no-op if not synced)
  // Tombstone only when signed in (so the delete propagates); otherwise hard-delete so anonymous users
  // don't accumulate garbage rows that never sync.
  if (isSyncing()) await softDeleteBook(id);
  else await db.books.delete(id);
  try {
    await db.catalogCache.delete(parseCacheKey(id));
  } catch {
    // best-effort cleanup of the parse cache
  }
}

export async function saveProgress(id: string, chapter: number): Promise<void> {
  try {
    await patchBook(id, { lastChapter: chapter });
  } catch {
    // progress is best-effort
  }
}
