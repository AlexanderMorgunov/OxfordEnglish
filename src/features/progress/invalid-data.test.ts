import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { db, type ExerciseAttempt, type ActivityDay } from '@/db/db';
import { activeDays, skillMap } from './metrics';
import { importData } from './backup';
import { emptyDay, summarize } from '@/features/stats/accounting';

const attempt: ExerciseAttempt = { exerciseId: 'exercise', tags: ['grammar'], correct: true, userAnswer: 'a', attemptNumber: 1, timestamp: 1, usedHint: false, usedAI: false };

beforeEach(async () => {
  await Promise.all([db.attempts.clear(), db.activity.clear(), db.wordStatus.clear(), db.pending.clear()]);
});

test('progress excludes invalid dates and missing tags without changing healthy metrics', () => {
  const invalid = JSON.parse('[{"timestamp":null},{"timestamp":1e100},null,{"exerciseId":"other","correct":true,"attemptNumber":1}]') as ExerciseAttempt[];
  expect([...activeDays([...invalid, attempt])]).toEqual(['1970-01-01']);
  expect(skillMap([...invalid, attempt])).toEqual([{ tag: 'grammar', correct: 1, total: 1, accuracy: 1 }]);
});

test('missing nested books does not discard healthy reading counters or mutate stored rows', () => {
  const row = { ...emptyDay('day:a', '2026-10-13'), readSec: 60, readWords: 20 };
  const bad = { ...row, books: undefined } as unknown as ActivityDay;
  const nested = { ...row, readSec: 0, books: { missing: null, bad: { title: 42, sec: 'wrong' }, good: { title: 'Good', sec: 5, words: 2, saved: 0 } } } as unknown as ActivityDay;
  const summary = summarize([bad, nested], [], 'day', new Date(2026, 9, 13, 12).getTime());
  expect(summary.readSec).toBe(60);
  expect(summary.books).toEqual([{ key: 'good', title: 'Good', sec: 5, words: 2, saved: 0 }]);
  expect(bad.books).toBeUndefined();
});

test.each([
  { attempts: [attempt, { ...attempt, timestamp: null }] },
  { attempts: [attempt, { ...attempt, tags: undefined }] },
  { attempts: [attempt, null] },
  { attempts: { length: 1 } },
  { activity: [{ ...emptyDay('day:a', '2026-10-13'), books: { bad: null } }] },
  { activity: [{ ...emptyDay('day:a', '2026-02-30') }] },
])('invalid imported history rejects the entire restore before data or queue changes (%j)', async data => {
  await db.wordStatus.put({ word: 'existing', status: 'known', firstSeenAt: 1, encounters: 1 });
  await expect(importData(JSON.stringify({ wordStatus: [{ word: 'incoming', status: 'learning', firstSeenAt: 1, encounters: 1 }], ...data }))).rejects.toThrow();
  expect(await db.attempts.count()).toBe(0);
  expect(await db.activity.count()).toBe(0);
  expect((await db.wordStatus.toArray()).map(row => row.word)).toEqual(['existing']);
  expect(await db.pending.count()).toBe(0);
});

test('healthy attempt extras survive import and partial old backups remain supported', async () => {
  await importData(JSON.stringify({ attempts: [{ ...attempt, extra: 'preserved' }] }));
  expect(await db.attempts.toArray()).toEqual([expect.objectContaining({ ...attempt, extra: 'preserved' })]);
  await importData('{}');
  await importData(JSON.stringify({ activity: [{ ...emptyDay('day:a', '2026-10-13'), books: undefined, readSec: 30 }] }));
  expect((await db.activity.get('day:a'))?.books).toEqual({});
  expect((await db.activity.get('day:a'))?.readSec).toBe(30);
});
