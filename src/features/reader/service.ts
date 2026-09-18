import { db, type BookRecord } from '@/db/db';
import { forgetBookFileOwner } from '@/features/account/store';
import { track } from '@/features/analytics/analytics';
import { addBook, patchBook, softDeleteBook, isSyncing } from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';
import { deleteRemoteBookFile, downloadBookFileIfMissing, uploadBookFile, useBookUploadIssues, type BookFileIssue } from './blobSync';
import { detectFormat, parseBook, type ParsedBook } from './parse';
import { saveBookFile, getBookFile, deleteBookFile, opfsAvailable } from './storage';

export type ImportResult = { record: BookRecord; book: ParsedBook };

// Reuses the catalogCache store (keys never collide — UUID vs slug). The `pdf:` prefix is kept so the
// entries written before this cached every format still hit.
const parseCacheKey = (id: string) => `pdf:${id}`;

/**
 * Cache a parsed book when parsing it actually cost something.
 *
 * This used to be "PDF only", on the reasoning that pdf.js walks every page while the EPUB/FB2/DOCX
 * parsers are cheap. Cheap on a laptop. On a phone, returning to a backgrounded tab reloads the page,
 * the reader remounts, and a large EPUB is unzipped and re-parsed from scratch every time — which is
 * the "loading book…" that sits there on resume.
 *
 * Measuring beats guessing per format: a two-page PDF does not need a cache and a 600-page EPUB does,
 * and the threshold answers for the device in hand rather than for the one this was written on.
 */
const SLOW_PARSE_MS = 150;

async function cacheParsed(id: string, book: ParsedBook): Promise<void> {
  try {
    await db.catalogCache.put({ id: parseCacheKey(id), book, cachedAt: Date.now() });
  } catch {
    // best-effort cache
  }
}


/** Thrown by openBook when the device has no readable file and says WHY. A bare throw here is what the
 *  reader turned into one blanket stub for five unrelated situations. */
export class BookFileUnavailable extends Error {
  constructor(public readonly issue: BookFileIssue) {
    super(issue);
    this.name = 'BookFileUnavailable';
  }
}

export async function importBook(file: File): Promise<ImportResult> {
  if (!opfsAvailable()) throw new Error('offline-storage-unavailable');
  const format = detectFormat(file.name);
  if (!format) throw new Error('unsupported-format');

  const startedAt = Date.now();
  const book = await parseBook(file, format);
  const slow = Date.now() - startedAt >= SLOW_PARSE_MS;
  const id = crypto.randomUUID();
  await saveBookFile(id, file);
  forgetBookFileOwner(); // no-op unless signed out, where these bytes belong to no account
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
  if (slow) await cacheParsed(id, book); // the import already paid for the parse; the first open should not
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
  try {
    const hit = await db.catalogCache.get(parseCacheKey(record.id));
    if (hit) {
      void track('book_open', { source: 'imported', format: record.format });
      return hit.book as ParsedBook;
    }
  } catch {
    // cache unavailable — fall through to a fresh parse
  }
  // Fetch the cloud copy on a device that only has the metadata. The reason it could not is carried out
  // rather than swallowed — on this path it is the whole explanation the reader has to offer.
  const issue = await downloadBookFileIfMissing(record.id);
  if (issue) throw new BookFileUnavailable(issue);
  const file = await getBookFile(record.id);
  const startedAt = Date.now();
  const parsed = await parseBook(file, record.format);
  if (Date.now() - startedAt >= SLOW_PARSE_MS) await cacheParsed(record.id, parsed);
  void track('book_open', { source: 'imported', format: record.format });
  return parsed;
}

export async function removeBook(id: string): Promise<void> {
  useBookUploadIssues.getState().note(id, null); // before either delete path, so both are covered
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
