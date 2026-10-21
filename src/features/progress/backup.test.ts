import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { db, type ActivityDay } from '@/db/db';
import { exportData, importData } from './backup';
import { createEmptyCard } from 'ts-fsrs';

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

test('an older review event cannot replace a corrected rating and local ties stay unchanged', async () => {
  const corrected = { id: 'r1', cardId: 'word:go', rating: 1, ts: 10, modifiedAt: 20 };
  await db.reviewLog.put(corrected);
  await importData(JSON.stringify({ reviewLog: [{ ...corrected, rating: 4, modifiedAt: undefined }] }));
  await importData(JSON.stringify({ reviewLog: [{ ...corrected, rating: 4 }] }));
  expect(await db.reviewLog.get('r1')).toEqual(corrected);
  const json = JSON.parse(await exportData()) as { reviewLog: unknown[] };
  expect(json.reviewLog).toContainEqual(corrected);
});

test('newer corrected history replaces a legacy event idempotently while unrelated events survive', async () => {
  await db.reviewLog.put({ id: 'r1', cardId: 'word:go', rating: 4, ts: 10 });
  await db.reviewLog.put({ id: 'r2', cardId: 'word:stay', rating: 3, ts: 15 });
  const corrected = { id: 'r1', cardId: 'word:go', rating: 1, ts: 10, modifiedAt: 20 };
  const json = JSON.stringify({ reviewLog: [corrected] });
  await importData(json);
  await importData(json);
  expect(await db.reviewLog.get('r1')).toEqual(corrected);
  expect(await db.reviewLog.count()).toBe(2);
});

test.each([null, 'newer', -1, 5])('invalid review modification time %s aborts the restore', async modifiedAt => {
  await db.activity.put(day({ readSec: 100 }));
  await expect(importData(JSON.stringify({
    activity: [day({ readSec: 200 })],
    reviewLog: [{ id: 'r1', cardId: 'word:go', rating: 4, ts: 10, modifiedAt }],
  }))).rejects.toThrow('Invalid review history');
  expect((await db.activity.get(day({}).id))?.readSec).toBe(100);
  expect(await db.reviewLog.count()).toBe(0);
});

test('corrected-event merge does not prevent deliberate restoration of an older card schedule', async () => {
  const before = createEmptyCard(new Date(0));
  const current = { ...before, reps: 2, due: new Date(1000) };
  await db.srsCards.put({ id: 'word:go', kind: 'word', front: 'go', back: 'идти', tags: [], card: current, due: current.due });
  await db.reviewLog.put({ id: 'r1', cardId: 'word:go', rating: 1, ts: 10, modifiedAt: 20 });
  await importData(JSON.stringify({
    srsCards: [{ id: 'word:go', kind: 'word', front: 'go', back: 'идти', tags: [], card: before, due: before.due, partOfSpeech: 'verb' }],
    reviewLog: [{ id: 'r1', cardId: 'word:go', rating: 4, ts: 10 }],
  }));
  expect((await db.srsCards.get('word:go'))?.card.reps).toBe(0);
  expect((await db.srsCards.get('word:go'))?.partOfSpeech).toBe('verb');
  expect((await db.reviewLog.get('r1'))?.rating).toBe(1);
});
