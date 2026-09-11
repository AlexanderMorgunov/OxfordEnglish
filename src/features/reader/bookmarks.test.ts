import 'fake-indexeddb/auto';
import { test, expect } from 'vitest';
import {
  snippetOf,
  topVisibleParagraph,
  resolvePageIndex,
  resolveParagraphIndex,
  resolveSentenceIndex,
  locateBookmark,
  sortBookmarks,
  formatBookmarkTime,
  addBookmark,
  toggleBookmark,
  listBookmarks,
  findBookmark,
} from './bookmarks';

test('snippetOf collapses whitespace and truncates with an ellipsis', () => {
  expect(snippetOf('  hello   world\n\nfoo ')).toBe('hello world foo');
  expect(snippetOf('abcdefghij', 5)).toBe('abcde…');
});

test('topVisibleParagraph picks the first paragraph at/below the reading line', () => {
  // scrolled so P0/P1 are above the top, P2 straddles just above with tolerance
  const rects = [
    { index: 0, top: -400 },
    { index: 1, top: -120 },
    { index: 2, top: -3 }, // within 8px tolerance -> current
    { index: 3, top: 200 },
  ];
  expect(topVisibleParagraph(rects)).toBe(2);
});

test('topVisibleParagraph falls back to last when everything scrolled above; null when empty', () => {
  expect(topVisibleParagraph([{ index: 0, top: -50 }, { index: 1, top: -20 }])).toBe(1);
  expect(topVisibleParagraph([])).toBeNull();
});

test('topVisibleParagraph accounts for a sticky top inset', () => {
  const rects = [
    { index: 0, top: 10 },
    { index: 1, top: 60 }, // first at/below the 48px sticky bar
    { index: 2, top: 300 },
  ];
  expect(topVisibleParagraph(rects, 48)).toBe(1);
});

test('resolvePageIndex prefers pageId, then clamps the raw index', () => {
  const pages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  expect(resolvePageIndex(pages, 'c', 0)).toBe(2); // pageId wins even when index drifted
  expect(resolvePageIndex(pages, 'gone', 1)).toBe(1); // fall back to raw index
  expect(resolvePageIndex(pages, undefined, 99)).toBe(2); // clamp
});

test('resolveParagraphIndex self-heals via the snippet when the index drifts', () => {
  const paras = ['Intro line.', 'The chronicle of Captain Blood was derived.', 'End.'];
  expect(resolveParagraphIndex(paras, 1, 'The chronicle of Captain Blood')).toBe(1);
  // index drifted (a paragraph was inserted above) — snippet finds it
  expect(resolveParagraphIndex(paras, 5, 'The chronicle of Captain Blood')).toBe(1);
  // no snippet match -> clamp
  expect(resolveParagraphIndex(paras, 9, 'nowhere')).toBe(2);
});

const base = {
  bookKey: 'reader.abc',
  page: 0,
  paragraph: 3,
  pageId: 'ch1',
  snippet: 'Hello there',
};

test('addBookmark dedupes on (bookKey, page, paragraph)', async () => {
  const a = await addBookmark(base);
  const b = await addBookmark(base);
  expect(b.id).toBe(a.id);
  expect((await listBookmarks('reader.abc')).length).toBe(1);
});

test('toggleBookmark adds then removes at the same spot', async () => {
  const key = 'reader.toggle';
  const spot = { ...base, bookKey: key };
  const first = await toggleBookmark(spot);
  expect(first.added).toBe(true);
  expect(await findBookmark(key, 0, 3)).toBeDefined();
  const second = await toggleBookmark(spot);
  expect(second.added).toBe(false);
  expect(await findBookmark(key, 0, 3)).toBeUndefined();
});

test('resolveSentenceIndex self-heals via the snippet; null without a stored sentence', () => {
  const sents = ['Yes.', 'The rabbit checked its watch.', 'Yes.'];
  expect(resolveSentenceIndex(sents, 1, 'The rabbit checked')).toBe(1);
  // index drifted but the snippet still pins the right (non-first) sentence
  expect(resolveSentenceIndex(sents, 4, 'The rabbit checked')).toBe(1);
  // short repeat: prefer the stored index, not the first "Yes."
  expect(resolveSentenceIndex(sents, 2, 'Yes.')).toBe(2);
  expect(resolveSentenceIndex(sents, undefined, 'x')).toBeNull();
});

test('bookmarks in the same paragraph are distinct per sentence (no collapse)', async () => {
  const key = 'reader.sentences';
  const s0 = { ...base, bookKey: key, sentence: 0, snippet: 'First sentence.' };
  const s1 = { ...base, bookKey: key, sentence: 1, snippet: 'Second sentence.' };
  await toggleBookmark(s0);
  await toggleBookmark(s1);
  expect((await listBookmarks(key)).length).toBe(2); // the second did not overwrite the first
  expect(await findBookmark(key, 0, 3, 0)).toBeDefined();
  expect(await findBookmark(key, 0, 3, 1)).toBeDefined();
  const removed = await toggleBookmark(s0);
  expect(removed.added).toBe(false);
  expect(await findBookmark(key, 0, 3, 0)).toBeUndefined();
  expect(await findBookmark(key, 0, 3, 1)).toBeDefined(); // sibling sentence untouched
});

const mk = (page: number, paragraph: number, createdAt: number, sentence?: number) => ({
  ...base,
  id: `${page}-${paragraph}-${sentence ?? ''}`,
  page,
  paragraph,
  createdAt,
  ...(sentence != null ? { sentence } : {}),
});

test('sortBookmarks: newest first, or book order; input untouched', () => {
  const list = [mk(1, 0, 100), mk(0, 5, 300), mk(0, 2, 200, 1)];
  expect(sortBookmarks(list, 'recent').map((b) => b.createdAt)).toEqual([300, 200, 100]);
  expect(sortBookmarks(list, 'book').map((b) => [b.page, b.paragraph])).toEqual([
    [0, 2],
    [0, 5],
    [1, 0],
  ]);
  expect(list[0]!.createdAt).toBe(100);
});

test('formatBookmarkTime: today / yesterday / date, year only when it differs', () => {
  const now = new Date(2026, 8, 11, 18, 0).getTime();
  expect(formatBookmarkTime(new Date(2026, 8, 11, 14, 32).getTime(), true, now)).toBe('сегодня 14:32');
  expect(formatBookmarkTime(new Date(2026, 8, 10, 9, 5).getTime(), false, now)).toBe('yesterday 09:05');
  expect(formatBookmarkTime(new Date(2026, 8, 1, 7, 0).getTime(), true, now)).toMatch(/^1 сент.*, 07:00$/);
  expect(formatBookmarkTime(new Date(2025, 0, 3, 7, 0).getTime(), false, now)).toContain('2025');
});

test('locateBookmark resolves the sentence and the words before it in its paragraph', () => {
  const pages = [{ id: 'p1', text: 'One two.\n\nThree four. Five six seven.' }];
  const bm = { ...mk(0, 1, 0, 1), pageId: 'p1', snippet: 'Five six seven.' };
  expect(locateBookmark(pages, bm)).toEqual({ page: 0, paragraph: 1, sentence: 1, wordsIn: 2 });
});

test('listBookmarks returns a book’s bookmarks in reading order', async () => {
  const key = 'reader.order';
  await addBookmark({ ...base, bookKey: key, page: 1, paragraph: 0, pageId: 'ch2' });
  await addBookmark({ ...base, bookKey: key, page: 0, paragraph: 5, pageId: 'ch1' });
  await addBookmark({ ...base, bookKey: key, page: 0, paragraph: 2, pageId: 'ch1' });
  const list = await listBookmarks(key);
  expect(list.map((b) => [b.page, b.paragraph])).toEqual([
    [0, 2],
    [0, 5],
    [1, 0],
  ]);
});
