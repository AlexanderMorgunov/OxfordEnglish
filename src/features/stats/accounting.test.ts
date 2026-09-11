import { describe, expect, it } from 'vitest';
import type { ActivityDay } from '@/db/db';
import {
  applyDelta,
  dwellNeededMs,
  emptyDay,
  isReading,
  localDayKey,
  mergeActivity,
  periodRange,
  pollCreditMs,
  summarize,
} from './accounting';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const row = (day: string, over: Partial<ActivityDay> = {}, device = 'a'): ActivityDay => ({
  ...emptyDay(`${day}:${device}`, day),
  ...over,
});

describe('localDayKey', () => {
  it('uses the local calendar day, late evening included', () => {
    expect(localDayKey(at(2026, 1, 5, 23))).toBe('2026-01-05');
    expect(localDayKey(at(2026, 1, 6, 0))).toBe('2026-01-06');
  });
});

describe('applyDelta', () => {
  it('adds counters and per-book tallies under dotted keys', () => {
    let r = row('2026-09-12');
    r = applyDelta(r, { readSec: 15, book: { key: 'reader.catalog.alice', title: 'Alice', sec: 15 } });
    r = applyDelta(r, { readWords: 120, book: { key: 'reader.catalog.alice', title: 'Alice', words: 120 } });
    r = applyDelta(r, { wordsSaved: 1 });
    expect(r).toMatchObject({ readSec: 15, readWords: 120, wordsSaved: 1 });
    expect(r.books['reader.catalog.alice']).toEqual({ title: 'Alice', sec: 15, words: 120, saved: 0 });
  });
});

describe('mergeActivity', () => {
  const local = row('2026-09-12', {
    readSec: 100,
    learned: 1,
    books: { 'reader.x': { title: 'X', sec: 100, words: 50, saved: 0 } },
  });
  const incoming = row('2026-09-12', {
    readSec: 60,
    learned: 3,
    books: {
      'reader.x': { title: 'X', sec: 40, words: 90, saved: 2 },
      'reader.y': { title: 'Y', sec: 20, words: 0, saved: 0 },
    },
  });

  it('keeps the larger value per field, nested books included', () => {
    const m = mergeActivity(local, incoming);
    expect(m).toMatchObject({ readSec: 100, learned: 3 });
    expect(m.books['reader.x']).toEqual({ title: 'X', sec: 100, words: 90, saved: 2 });
    expect(m.books['reader.y']).toEqual({ title: 'Y', sec: 20, words: 0, saved: 0 });
  });

  it('is idempotent and takes the incoming row when there is no local one', () => {
    const once = mergeActivity(local, incoming);
    expect(mergeActivity(once, incoming)).toEqual(once);
    expect(mergeActivity(undefined, incoming)).toBe(incoming);
  });
});

describe('tracker rules', () => {
  const p = { visible: true, focused: true, speaking: false, sinceInputMs: 1_000 };

  it('counts only visible, focused, recently active (or listening) time', () => {
    expect(isReading(p)).toBe(true);
    expect(isReading({ ...p, visible: false })).toBe(false);
    expect(isReading({ ...p, focused: false })).toBe(false);
    expect(isReading({ ...p, sinceInputMs: 200_000 })).toBe(false);
    expect(isReading({ ...p, sinceInputMs: 200_000, speaking: true })).toBe(true);
  });

  it('credits real elapsed time per poll, capped so a late timer cannot over-credit', () => {
    expect(pollCreditMs(1_003)).toBe(1_003);
    expect(pollCreditMs(60_000)).toBe(2_000);
    expect(pollCreditMs(-5)).toBe(0);
  });

  it('needs a paragraph on screen for its words at 600 wpm', () => {
    expect(dwellNeededMs(100)).toBe(10_000);
    expect(dwellNeededMs(0)).toBe(0);
  });
});

describe('periods', () => {
  const now = at(2026, 9, 12);

  it('builds day, week, month and year buckets ending today', () => {
    expect(periodRange('day', now)).toEqual({ from: '2026-09-12', to: '2026-09-12', buckets: ['2026-09-12'] });
    const week = periodRange('week', now);
    expect(week.buckets).toHaveLength(7);
    expect(week.from).toBe('2026-09-06');
    expect(periodRange('month', now).buckets).toHaveLength(30);
    const year = periodRange('year', now);
    expect(year.buckets[0]).toBe('2025-10');
    expect(year.buckets[11]).toBe('2026-09');
    expect(year.from).toBe('2025-10-01');
  });

  it('sums every device in range, groups books, and counts recalled reviews', () => {
    const rows = [
      row('2026-09-12', { readSec: 60, wordsSaved: 2, books: { 'reader.x': { title: 'X', sec: 60, words: 10, saved: 2 } } }, 'a'),
      row('2026-09-12', { readSec: 30, books: { 'reader.x': { title: 'X', sec: 30, words: 5, saved: 0 } } }, 'b'),
      row('2026-09-10', { readSec: 90 }),
      row('2026-08-01', { readSec: 999 }),
    ];
    const reviews = [
      { ts: at(2026, 9, 12), rating: 3 },
      { ts: at(2026, 9, 11), rating: 1 },
      { ts: at(2026, 8, 1), rating: 4 },
    ];
    const week = summarize(rows, reviews, 'week', now);
    expect(week).toMatchObject({ readSec: 180, wordsSaved: 2, reviews: 2, recalled: 1 });
    expect(week.books).toEqual([{ key: 'reader.x', title: 'X', sec: 90, words: 15, saved: 2 }]);
    expect(week.bars.at(-1)).toEqual({ key: '2026-09-12', sec: 90 });
    expect(summarize(rows, reviews, 'day', now).readSec).toBe(90);
    expect(summarize(rows, reviews, 'year', now).bars.find((b) => b.key === '2026-08')?.sec).toBe(999);
  });
});
