import type { ActivityDay, BookActivity } from '@/db/db';

const pad = (n: number) => String(n).padStart(2, '0');

/** Local calendar day, YYYY-MM-DD. metrics.ts keys attempts by UTC; reading stats follow the reader's midnight. */
export function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type ActivityDelta = {
  readSec?: number;
  readWords?: number;
  wordsSaved?: number;
  phrasesSaved?: number;
  learned?: number;
  book?: { key: string; title: string; sec?: number; words?: number; saved?: number };
};

const COUNTERS = ['readSec', 'readWords', 'wordsSaved', 'phrasesSaved', 'learned'] as const;

export function emptyDay(id: string, day: string): ActivityDay {
  return { id, day, readSec: 0, readWords: 0, wordsSaved: 0, phrasesSaved: 0, learned: 0, books: {} };
}

/** Add a delta to a day row (plain object merge: book keys contain dots, so no Dexie keypath updates). */
export function applyDelta(row: ActivityDay, d: ActivityDelta): ActivityDay {
  const next: ActivityDay = { ...row, books: { ...row.books } };
  for (const k of COUNTERS) next[k] += d[k] ?? 0;
  if (d.book) {
    const prev = next.books[d.book.key] ?? { title: d.book.title, sec: 0, words: 0, saved: 0 };
    next.books[d.book.key] = {
      title: d.book.title || prev.title,
      sec: prev.sec + (d.book.sec ?? 0),
      words: prev.words + (d.book.words ?? 0),
      saved: prev.saved + (d.book.saved ?? 0),
    };
  }
  return next;
}

const maxBook = (a: BookActivity, b: BookActivity): BookActivity => ({
  title: a.title || b.title,
  sec: Math.max(a.sec, b.sec),
  words: Math.max(a.words, b.words),
  saved: Math.max(a.saved, b.saved),
});

/** Backup import of a device-day row this device may already hold: keep the larger count per field, so
 *  re-importing the same backup changes nothing. */
export function mergeActivity(local: ActivityDay | undefined, incoming: ActivityDay): ActivityDay {
  if (!local) return incoming;
  const out: ActivityDay = { ...local, books: { ...local.books } };
  for (const k of COUNTERS) out[k] = Math.max(local[k], incoming[k] ?? 0);
  for (const [key, b] of Object.entries(incoming.books ?? {})) {
    const mine = out.books[key];
    out.books[key] = mine ? maxBook(mine, b) : b;
  }
  return out;
}

export const POLL_MS = 1_000;
export const FLUSH_MS = 15_000;
export const IDLE_MS = 180_000;
export const MAX_WPM = 600;

export type Presence = { visible: boolean; focused: boolean; speaking: boolean; sinceInputMs: number };

/** Reading time counts while the page is visible and focused, and the reader either touched it
 *  recently or is listening to read-aloud. */
export function isReading(p: Presence): boolean {
  return p.visible && p.focused && (p.speaking || p.sinceInputMs <= IDLE_MS);
}

/** Milliseconds one poll credits: real elapsed time, capped so a late (throttled) timer can't over-credit. */
export function pollCreditMs(elapsedMs: number): number {
  return Math.max(0, Math.min(elapsedMs, 2 * POLL_MS));
}

/** A paragraph counts as read once it has been on screen for its reading time at MAX_WPM. */
export function dwellNeededMs(words: number): number {
  return Math.ceil((words / MAX_WPM) * 60_000);
}

export type Period = 'day' | 'week' | 'month' | 'year';

/** Inclusive local-day range of a period ending today, and its bar buckets (days, or months for a year). */
export function periodRange(period: Period, now: number): { from: string; to: string; buckets: string[] } {
  const d = new Date(now);
  const day = (offset: number) => localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset).getTime());
  const to = localDayKey(now);
  if (period === 'year') {
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = new Date(d.getFullYear(), d.getMonth() - 11 + i, 1);
      return `${m.getFullYear()}-${pad(m.getMonth() + 1)}`;
    });
    return { from: `${months[0]}-01`, to, buckets: months };
  }
  const n = period === 'day' ? 1 : period === 'week' ? 7 : 30;
  const buckets = Array.from({ length: n }, (_, i) => day(n - 1 - i));
  return { from: buckets[0]!, to, buckets };
}

export type Summary = {
  readSec: number;
  readWords: number;
  wordsSaved: number;
  phrasesSaved: number;
  learned: number;
  reviews: number;
  recalled: number;
  bars: { key: string; sec: number }[];
  books: (BookActivity & { key: string })[];
};

/** Totals for a period across every device's rows; a review is "recalled" at rating Good or Easy. */
export function summarize(
  rows: ActivityDay[],
  reviews: { ts: number; rating: number }[],
  period: Period,
  now: number
): Summary {
  const { from, to, buckets } = periodRange(period, now);
  const inRange = (day: string) => day >= from && day <= to;
  const bucketOf = (day: string) => (period === 'year' ? day.slice(0, 7) : day);
  const bars = new Map(buckets.map((b) => [b, 0]));
  const books = new Map<string, BookActivity>();
  const s: Summary = { readSec: 0, readWords: 0, wordsSaved: 0, phrasesSaved: 0, learned: 0, reviews: 0, recalled: 0, bars: [], books: [] };
  for (const r of rows) {
    if (!inRange(r.day)) continue;
    for (const k of COUNTERS) s[k] += r[k];
    const b = bucketOf(r.day);
    if (bars.has(b)) bars.set(b, bars.get(b)! + r.readSec);
    for (const [key, v] of Object.entries(r.books)) {
      const acc = books.get(key);
      books.set(
        key,
        acc
          ? { title: acc.title || v.title, sec: acc.sec + v.sec, words: acc.words + v.words, saved: acc.saved + v.saved }
          : { ...v }
      );
    }
  }
  for (const rv of reviews) {
    if (!inRange(localDayKey(rv.ts))) continue;
    s.reviews += 1;
    if (rv.rating >= 3) s.recalled += 1;
  }
  s.bars = buckets.map((key) => ({ key, sec: bars.get(key)! }));
  s.books = [...books].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.sec - a.sec);
  return s;
}
