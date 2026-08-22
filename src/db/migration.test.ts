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
  v2.version(4).stores({ analyticsQueue: '++id, ts' });
  v2.version(5).stores({ feedbackOutbox: '++id, createdAt' });
  v2.version(6).stores({ bookmarks: 'id, bookKey, createdAt, [bookKey+page+paragraph]' });
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

  // v4 adds analyticsQueue, again leaving prior stores intact
  await v2.table('analyticsQueue').add({ event: 'app_open', ts: 1 });
  expect(await v2.table('analyticsQueue').count()).toBe(1);
  expect(await v2.table('wordStatus').count()).toBe(1);

  // v5 adds feedbackOutbox, prior stores still intact
  await v2.table('feedbackOutbox').add({ body: { message: 'hi' }, createdAt: 1 });
  expect(await v2.table('feedbackOutbox').count()).toBe(1);
  expect(await v2.table('books').count()).toBe(1);

  // v6 adds bookmarks; the compound [bookKey+page+paragraph] index supports dedupe lookups
  await v2.table('bookmarks').add({ id: 'bm1', bookKey: 'reader.x', page: 0, paragraph: 2, pageId: 'c1', snippet: 's', createdAt: 1 });
  expect(await v2.table('bookmarks').where('[bookKey+page+paragraph]').equals(['reader.x', 0, 2]).count()).toBe(1);
  expect(await v2.table('wordStatus').count()).toBe(1);
  v2.close();
  await Dexie.delete(name);
});
