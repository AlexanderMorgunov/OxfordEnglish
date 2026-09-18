/**
 * Returning to a backgrounded tab reloads the page on a phone, so the reader remounts and opens the
 * book again from scratch — which is the "loading book…" that sits there on resume.
 *
 * Only PDFs were cached, on the reasoning that the EPUB/FB2/DOCX parsers are cheap. Cheap on a laptop:
 * a large EPUB is unzipped and re-parsed every single time. The rule is now what the parse actually
 * cost, which answers for the device in hand rather than for the one the code was written on.
 */
import 'fake-indexeddb/auto';
import { vi, test, expect, beforeEach } from 'vitest';

const parseBook = vi.fn();

vi.mock('./storage', () => ({
  saveBookFile: vi.fn(async () => undefined),
  getBookFile: vi.fn(async () => new File(['x'], 'b.epub')),
  deleteBookFile: vi.fn(async () => undefined),
  opfsAvailable: () => true,
}));
vi.mock('./parse', () => ({ detectFormat: () => 'epub', parseBook: (...a: unknown[]) => parseBook(...a) }));
vi.mock('./blobSync', () => ({
  uploadBookFile: vi.fn(async () => 'ok'),
  downloadBookFileIfMissing: vi.fn(async () => null),
  deleteRemoteBookFile: vi.fn(async () => undefined),
  useBookUploadIssues: { getState: () => ({ note: () => undefined, prune: () => undefined }) },
}));

import { db, type BookRecord } from '@/db/db';
import { openBook, removeBook } from './service';

const book = (title = 'T') => ({ title, author: 'A', chapters: [{ title: 'c', blocks: [] }] });

/** A parse that takes `ms` of wall clock, so the cache decision has something real to measure. */
const takes = (ms: number, value = book()) =>
  parseBook.mockImplementation(async () => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      /* the reader is blocked on exactly this */
    }
    return value;
  });

const record: BookRecord = {
  id: 'bk1', title: 'T', format: 'epub', addedAt: 1, chapterCount: 1, lastChapter: 0,
};

beforeEach(async () => {
  vi.clearAllMocks();
  if (!db.isOpen()) await db.open();
  await Promise.all([db.catalogCache.clear(), db.books.clear()]);
});

test('a slow parse is remembered, so the next open does not repeat it', async () => {
  takes(200);

  await openBook(record);
  await openBook(record);

  expect(parseBook).toHaveBeenCalledTimes(1);
});

test('and an EPUB is remembered just like a PDF — the format was never the question', async () => {
  takes(200);

  await openBook(record);

  expect(await db.catalogCache.get('pdf:bk1')).toBeTruthy();
});

test('a parse that cost nothing is not worth a cache entry', async () => {
  takes(0);

  await openBook(record);
  await openBook(record);

  // Every imported book carrying a second copy of its own text would be the wrong trade for a parse
  // nobody waits on.
  expect(await db.catalogCache.get('pdf:bk1')).toBeUndefined();
  expect(parseBook).toHaveBeenCalledTimes(2);
});

test('the cached copy is the one the reader gets', async () => {
  takes(200, book('From the parse'));
  const first = await openBook(record);

  takes(200, book('A different parse'));
  const second = await openBook(record);

  expect(first.title).toBe('From the parse');
  expect(second.title).toBe('From the parse');
});

test('removing the book takes its cached text with it', async () => {
  takes(200);
  await db.books.put(record);
  await openBook(record);

  await removeBook('bk1');

  // Otherwise the text of a deleted book outlives it, which is both dead weight and a book somebody
  // meant to remove from a shared device.
  expect(await db.catalogCache.get('pdf:bk1')).toBeUndefined();
});
