import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { db } from '@/db/db';
import { addAttempt, putWordStatus, softDeleteBook, softDeleteBookmark, stampImported } from './local';
import { isDeleted } from './resolve';

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.attempts.clear(), db.wordStatus.clear(), db.books.clear(), db.bookmarks.clear(), db.pending.clear()]);
});

test('addAttempt stamps a global syncId + meta (updatedAt = event time)', async () => {
  await addAttempt({ exerciseId: 'e1', tags: [], correct: true, userAnswer: 'x', attemptNumber: 1, timestamp: 4242, usedHint: false, usedAI: false });
  const row = (await db.attempts.toArray())[0]!;
  expect(row.syncId).toMatch(/.+:.+/);
  expect(row.updatedAt).toBe(4242);
  expect(row.updatedBy).toBeTruthy();
});

test('putWordStatus bumps statusUpdatedAt only when the status value changes (F6)', async () => {
  await putWordStatus({ word: 'apple', status: 'learning', firstSeenAt: 1, encounters: 1 });
  const first = (await db.wordStatus.get('apple'))!;
  expect(first.statusUpdatedAt).toBeTruthy();

  // Same status, another sighting → statusUpdatedAt must NOT move (only updatedAt tracks any change).
  await putWordStatus({ word: 'apple', status: 'learning', firstSeenAt: 1, encounters: 2 });
  const second = (await db.wordStatus.get('apple'))!;
  expect(second.statusUpdatedAt).toBe(first.statusUpdatedAt);
  expect(second.encounters).toBe(2);

  // Status actually changes → statusUpdatedAt advances.
  await putWordStatus({ word: 'apple', status: 'known', firstSeenAt: 1, encounters: 3 });
  const third = (await db.wordStatus.get('apple'))!;
  expect(third.statusUpdatedAt).toBeGreaterThanOrEqual(first.statusUpdatedAt!);
  expect(third.status).toBe('known');
});

test('softDeleteBook tombstones the row (deletedAt set, updatedAt NOT bumped — H1)', async () => {
  await db.books.put({ id: 'b1', title: 'T', format: 'epub', addedAt: 1, chapterCount: 1, lastChapter: 0, updatedAt: 100, updatedBy: 'inst' });
  await softDeleteBook('b1');
  const row = (await db.books.get('b1'))!;
  expect(row.deletedAt).toBeTruthy();
  expect(row.updatedAt).toBe(100); // a delete must not bump updatedAt, else a later re-add can't win
  expect(isDeleted(row)).toBe(true);
});

test('softDeleteBookmark tombstones the bookmark (same H1 semantics)', async () => {
  await db.bookmarks.put({ id: 'bm1', bookKey: 'k', page: 0, paragraph: 0, pageId: 'p', snippet: 's', createdAt: 10, updatedAt: 10, updatedBy: 'inst' });
  await softDeleteBookmark('bm1');
  const row = (await db.bookmarks.get('bm1'))!;
  expect(isDeleted(row)).toBe(true);
  expect(row.updatedAt).toBe(10);
});

test('stampImported gives each append-only row a distinct global syncId + meta (no undefined collision)', () => {
  const rows = [
    { exerciseId: 'e1', tags: [], correct: true, userAnswer: 'x', attemptNumber: 1, timestamp: 100, usedHint: false, usedAI: false },
    { exerciseId: 'e2', tags: [], correct: false, userAnswer: 'y', attemptNumber: 1, timestamp: 200, usedHint: false, usedAI: false },
  ];
  const out = stampImported('attempts', rows, 'inst') as Array<{ syncId?: string; updatedAt?: number; updatedBy?: string }>;
  expect(out[0]!.syncId).toMatch(/^inst:/);
  expect(out[0]!.syncId).not.toBe(out[1]!.syncId); // distinct — not all colliding as 'undefined'
  expect(out[0]!.updatedAt).toBe(100); // backfilled from timestamp
  expect(out[0]!.updatedBy).toBe('inst');
});

test('stampImported preserves meta already carried by a sync-aware backup', () => {
  const out = stampImported('books', [{ id: 'b1', addedAt: 5, updatedAt: 999, updatedBy: 'other' }], 'inst') as Array<{ updatedAt?: number; updatedBy?: string }>;
  expect(out[0]!.updatedBy).toBe('other');
  expect(out[0]!.updatedAt).toBe(999);
});
