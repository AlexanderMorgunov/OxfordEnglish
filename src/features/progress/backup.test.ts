import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { db, type ActivityDay } from '@/db/db';
import { exportData, importData } from './backup';

const day = (over: Partial<ActivityDay>): ActivityDay => ({
  id: '2026-09-12:dev',
  day: '2026-09-12',
  readSec: 0,
  readWords: 0,
  wordsSaved: 0,
  phrasesSaved: 0,
  learned: 0,
  books: {},
  ...over,
});

beforeEach(async () => {
  await db.activity.clear();
  await db.reviewLog.clear();
});

test('export carries activity and the review log (payload v4)', async () => {
  await db.activity.put(day({ readSec: 30 }));
  await db.reviewLog.add({ id: 'r1', cardId: 'word:go', rating: 3, ts: 1 });
  const json = JSON.parse(await exportData()) as { version: number; activity: unknown[]; reviewLog: unknown[] };
  expect(json.version).toBe(4);
  expect(json.activity).toHaveLength(1);
  expect(json.reviewLog).toHaveLength(1);
});

test('import merges activity by max per field and is idempotent', async () => {
  await db.activity.put(day({ readSec: 100, books: { 'reader.x': { title: 'X', sec: 100, words: 5, saved: 0 } } }));
  const backup = JSON.stringify({
    activity: [day({ readSec: 40, learned: 2, books: { 'reader.x': { title: 'X', sec: 40, words: 50, saved: 1 } } })],
    reviewLog: [{ id: 'r1', cardId: 'word:go', rating: 3, ts: 1 }],
  });
  await importData(backup);
  await importData(backup);
  const row = await db.activity.get('2026-09-12:dev');
  expect(row).toMatchObject({ readSec: 100, learned: 2 });
  expect(row?.books['reader.x']).toEqual({ title: 'X', sec: 100, words: 50, saved: 1 });
  expect(await db.reviewLog.count()).toBe(1);
});
