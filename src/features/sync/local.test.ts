import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { db } from '@/db/db';
import { addAttempt, putWordStatus } from './local';

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.attempts.clear(), db.wordStatus.clear(), db.pending.clear()]);
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
