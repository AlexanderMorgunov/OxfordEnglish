import 'fake-indexeddb/auto';
import { test, expect } from 'vitest';
import Dexie from 'dexie';

// Guards against the classic Dexie footgun: a v2 that omits existing stores must NOT drop
// them. Existing users already hold v1 data (vocabulary, FSRS cards) — losing it on upgrade
// would be unrecoverable. This mirrors src/db/db.ts's v1 → v2 schema exactly.
test('v2 upgrade preserves v1 data and adds the books table', async () => {
  const name = 'oxford-migration-test';
  await Dexie.delete(name);

  const v1 = new Dexie(name);
  v1.version(1).stores({
    attempts: '++id, exerciseId, timestamp, *tags',
    wordStatus: 'word, status',
    srsCards: 'id, due, *tags',
    checkpoints: '++id, unitId, timestamp',
    translations: 'word',
  });
  await v1.open();
  await v1.table('wordStatus').add({ word: 'hello', status: 'known', firstSeenAt: 1, encounters: 1 });
  await v1.table('attempts').add({ exerciseId: 'x', tags: [], correct: true, userAnswer: 'a', attemptNumber: 1, timestamp: 1, usedHint: false, usedAI: false });
  v1.close();

  const v2 = new Dexie(name);
  v2.version(1).stores({
    attempts: '++id, exerciseId, timestamp, *tags',
    wordStatus: 'word, status',
    srsCards: 'id, due, *tags',
    checkpoints: '++id, unitId, timestamp',
    translations: 'word',
  });
  v2.version(2).stores({ books: 'id, addedAt' });
  v2.version(3).stores({ catalogCache: 'id, cachedAt' });
  await v2.open();

  expect(await v2.table('wordStatus').count()).toBe(1);
  expect(await v2.table('attempts').count()).toBe(1);
  expect((await v2.table('wordStatus').get('hello'))?.status).toBe('known');

  expect(await v2.table('books').count()).toBe(0);
  await v2.table('books').add({ id: 'b1', title: 'T', format: 'epub', addedAt: 1, chapterCount: 3, lastChapter: 0 });
  expect(await v2.table('books').count()).toBe(1);

  // v3 adds catalogCache without disturbing anything above
  await v2.table('catalogCache').add({ id: 'c1', book: { title: 'X', chapters: [] }, cachedAt: 1 });
  expect(await v2.table('catalogCache').count()).toBe(1);
  v2.close();
  await Dexie.delete(name);
});
