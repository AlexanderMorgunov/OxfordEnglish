import { db, type BookRecord } from '@/db/db';
import { detectFormat, parseBook, type ParsedBook } from './parse';
import { saveBookFile, getBookFile, deleteBookFile, opfsAvailable } from './storage';

export type ImportResult = { record: BookRecord; book: ParsedBook };

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
  await db.books.add(record);
  return { record, book };
}

export async function listBooks(): Promise<BookRecord[]> {
  try {
    return await db.books.orderBy('addedAt').reverse().toArray();
  } catch {
    return [];
  }
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  return db.books.get(id);
}

export async function openBook(record: BookRecord): Promise<ParsedBook> {
  const file = await getBookFile(record.id);
  return parseBook(file, record.format);
}

export async function removeBook(id: string): Promise<void> {
  await deleteBookFile(id);
  await db.books.delete(id);
}

export async function saveProgress(id: string, chapter: number): Promise<void> {
  try {
    await db.books.update(id, { lastChapter: chapter });
  } catch {
    // progress is best-effort
  }
}
