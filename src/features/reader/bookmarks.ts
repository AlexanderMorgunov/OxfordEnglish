import { db, type Bookmark } from '@/db/db';
import { toSentences } from './parse/text';
import { countWords, splitParas } from './position';
import type { BookmarkSort } from './settings';

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

/** Resolve a bookmark's sentence within its paragraph: prefer the stored index if its snippet still
 *  matches (short repeats like "Yes." stay put), else the sentence that begins with the snippet, else
 *  clamp. Null when the bookmark has no stored sentence (legacy paragraph-level). */
export function resolveSentenceIndex(
  sentences: string[],
  sentence: number | undefined,
  snippet: string
): number | null {
  if (sentence == null || sentences.length === 0) return null;
  const clamp = (n: number) => Math.max(0, Math.min(n, sentences.length - 1));
  const key = snippet.replace(/…$/, '').slice(0, 24);
  if (key) {
    if (sentences[sentence]?.replace(/\s+/g, ' ').trim().startsWith(key)) return clamp(sentence);
    const i = sentences.findIndex((s) => s.replace(/\s+/g, ' ').trim().startsWith(key));
    if (i >= 0) return i;
  }
  return clamp(sentence);
}

/** Where a bookmark points in the current pagination (self-healing via pageId + snippet), plus how
 *  many words into its paragraph the bookmarked sentence starts. */
export function locateBookmark(pages: { id: string; text: string }[], bm: Bookmark) {
  const page = resolvePageIndex(pages, bm.pageId, bm.page);
  const paras = splitParas(pages[page]?.text ?? '');
  const paragraph = resolveParagraphIndex(paras, bm.paragraph, bm.snippet);
  const sentences = toSentences(paras[paragraph] ?? '');
  const sentence = resolveSentenceIndex(sentences, bm.sentence, bm.snippet);
  const wordsIn = sentence ? countWords(sentences.slice(0, sentence).join(' ')) : 0;
  return { page, paragraph, sentence, wordsIn };
}

export function sortBookmarks(list: Bookmark[], mode: BookmarkSort): Bookmark[] {
  const out = [...list];
  return mode === 'recent'
    ? out.sort((a, b) => b.createdAt - a.createdAt)
    : out.sort(
        (a, b) => a.page - b.page || a.paragraph - b.paragraph || (a.sentence ?? -1) - (b.sentence ?? -1)
      );
}

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** «сегодня 14:32» / «вчера 14:32» / «12 сент., 14:32» (year added when it differs). */
export function formatBookmarkTime(ts: number, ru: boolean, now = Date.now()): string {
  const locale = ru ? 'ru-RU' : 'en-GB';
  const d = new Date(ts);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  // Rounded, not floored: a DST day is 23 or 25 hours long.
  const days = Math.round((dayStart(now) - dayStart(ts)) / 86_400_000);
  if (days === 0) return `${ru ? 'сегодня' : 'today'} ${time}`;
  if (days === 1) return `${ru ? 'вчера' : 'yesterday'} ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = d.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}

export async function listBookmarks(bookKey: string): Promise<Bookmark[]> {
  try {
    const rows = await db.bookmarks.where('bookKey').equals(bookKey).toArray();
    return rows.sort(
      (a, b) => a.page - b.page || a.paragraph - b.paragraph || (a.sentence ?? -1) - (b.sentence ?? -1)
    );
  } catch {
    return [];
  }
}

/** The bookmark at an exact spot. Fetches the paragraph's rows via the compound index, then matches
 *  `sentence` in JS — so two sentence-level bookmarks in one paragraph are distinct (undefined ≠ 0). */
export async function findBookmark(
  bookKey: string,
  page: number,
  paragraph: number,
  sentence?: number
): Promise<Bookmark | undefined> {
  const rows = await db.bookmarks
    .where('[bookKey+page+paragraph]')
    .equals([bookKey, page, paragraph])
    .toArray();
  return rows.find((b) => (b.sentence ?? null) === (sentence ?? null));
}

/** Add unless an identical (bookKey, page, paragraph, sentence) bookmark already exists (dedupe). */
export async function addBookmark(input: NewBookmark): Promise<Bookmark> {
  const existing = await findBookmark(input.bookKey, input.page, input.paragraph, input.sentence);
  if (existing) return existing;
  const bookmark: Bookmark = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
  await db.bookmarks.add(bookmark);
  return bookmark;
}

export async function removeBookmark(id: string): Promise<void> {
  await db.bookmarks.delete(id);
}

/** Add the bookmark, or remove the existing one at the same spot. Returns whether it was added. */
export async function toggleBookmark(input: NewBookmark): Promise<{ added: boolean }> {
  const existing = await findBookmark(input.bookKey, input.page, input.paragraph, input.sentence);
  if (existing) {
    await db.bookmarks.delete(existing.id);
    return { added: false };
  }
  await addBookmark(input);
  return { added: true };
}
