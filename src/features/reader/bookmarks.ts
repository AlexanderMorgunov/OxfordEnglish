import { db, type Bookmark } from '@/db/db';
import { addBookmark as addBookmarkSynced } from '@/features/sync/local';

export type { Bookmark };
export type NewBookmark = Omit<Bookmark, 'id' | 'createdAt'>;

/** A short, whitespace-collapsed label for a bookmarked paragraph. */
export function snippetOf(text: string, max = 80): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/**
 * The paragraph currently at the top of the reading area. `rects` must be in document order
 * (== paragraph index order, so `top` is ascending). Returns the first paragraph whose top has
 * not scrolled above the reading line (`topInset`), with an 8px tolerance so a paragraph that
 * was just scrolled/jumped to a sub-pixel negative offset still counts as the current one —
 * otherwise a bookmark toggle would target the *next* paragraph. Falls back to the last
 * paragraph when everything has scrolled above; null for an empty page.
 */
export function topVisibleParagraph(
  rects: { index: number; top: number }[],
  topInset = 0
): number | null {
  if (rects.length === 0) return null;
  const line = topInset - 8;
  const hit = rects.find((r) => r.top >= line);
  return hit ? hit.index : rects[rects.length - 1]!.index;
}

/** Resolve a bookmark's page: prefer the stable `pageId`, then the raw index, clamped. */
export function resolvePageIndex(
  pages: { id: string }[],
  pageId: string | undefined,
  fallback: number
): number {
  if (pageId) {
    const i = pages.findIndex((p) => p.id === pageId);
    if (i >= 0) return i;
  }
  return Math.max(0, Math.min(fallback, pages.length - 1));
}

/** Resolve a bookmark's paragraph within a page: prefer the stored index if the snippet still
 *  matches there, else find the paragraph that begins with the snippet, else clamp the index. */
export function resolveParagraphIndex(
  paragraphs: string[],
  paragraph: number,
  snippet: string
): number {
  const clamp = (n: number) => Math.max(0, Math.min(n, paragraphs.length - 1));
  const key = snippet.replace(/…$/, '').slice(0, 24);
  if (key) {
    if (paragraphs[paragraph]?.replace(/\s+/g, ' ').trimStart().startsWith(key)) return clamp(paragraph);
    const i = paragraphs.findIndex((p) => p.replace(/\s+/g, ' ').trimStart().startsWith(key));
    if (i >= 0) return i;
  }
  return clamp(paragraph);
}

export async function listBookmarks(bookKey: string): Promise<Bookmark[]> {
  try {
    const rows = await db.bookmarks.where('bookKey').equals(bookKey).toArray();
    return rows.sort((a, b) => a.page - b.page || a.paragraph - b.paragraph);
  } catch {
    return [];
  }
}

export function findBookmark(
  bookKey: string,
  page: number,
  paragraph: number
): Promise<Bookmark | undefined> {
  return db.bookmarks.where('[bookKey+page+paragraph]').equals([bookKey, page, paragraph]).first();
}

/** Add unless an identical (bookKey, page, paragraph) bookmark already exists (dedupe). */
export async function addBookmark(input: NewBookmark): Promise<Bookmark> {
  const existing = await findBookmark(input.bookKey, input.page, input.paragraph);
  if (existing) return existing;
  const bookmark: Bookmark = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
  await addBookmarkSynced(bookmark);
  return bookmark;
}

export async function removeBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id);
}

/** Add the bookmark, or remove the existing one at the same spot. Returns whether it was added. */
export async function toggleBookmark(input: NewBookmark): Promise<{ added: boolean }> {
  const existing = await findBookmark(input.bookKey, input.page, input.paragraph);
  if (existing) {
    await db.bookmarks.delete(existing.id);
    return { added: false };
  }
  await addBookmark(input);
  return { added: true };
}
