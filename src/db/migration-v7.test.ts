import 'fake-indexeddb/auto';
import { test, expect } from 'vitest';
import Dexie from 'dexie';
import { db } from './db';

// The real upgrade path: a v6 database under the app's own name, then the app's `db` opens it.
// Own file on purpose — `db` must not have been opened before the seed.
test('v7 upgrade keeps v6 data and adds activity + reviewLog', async () => {
  const v6 = new Dexie('oxford-english');
  v6.version(1).stores({
    attempts: '++id, exerciseId, timestamp, *tags',
    wordStatus: 'word, status',
    srsCards: 'id, due, *tags',
    checkpoints: '++id, unitId, timestamp',
    translations: 'word',
  });
  v6.version(2).stores({ books: 'id, addedAt' });
  v6.version(3).stores({ catalogCache: 'id, cachedAt' });
  v6.version(4).stores({ analyticsQueue: '++id, ts' });
  v6.version(5).stores({ feedbackOutbox: '++id, createdAt' });
  v6.version(6).stores({ bookmarks: 'id, bookKey, createdAt, [bookKey+page+paragraph]' });
  await v6.open();
  await v6.table('wordStatus').add({ word: 'hello', status: 'known', firstSeenAt: 1, encounters: 1 });
  await v6.table('srsCards').add({ id: 'word:hello', kind: 'word', front: 'hello', back: 'привет', tags: [], due: new Date(0), card: {} });
  await v6.table('bookmarks').add({ id: 'bm1', bookKey: 'reader.x', page: 0, paragraph: 2, pageId: 'c1', snippet: 's', createdAt: 1 });
  v6.close();

  await db.open();
  expect(db.verno).toBe(7);
  expect((await db.wordStatus.get('hello'))?.status).toBe('known');
  expect(await db.srsCards.count()).toBe(1);
  expect(await db.bookmarks.where('[bookKey+page+paragraph]').equals(['reader.x', 0, 2]).count()).toBe(1);

  await db.activity.put({ id: '2026-09-12:dev', day: '2026-09-12', readSec: 15, readWords: 0, wordsSaved: 0, phrasesSaved: 0, learned: 0, books: {} });
  await db.reviewLog.add({ id: 'r1', cardId: 'word:hello', rating: 3, ts: 1 });
  expect(await db.activity.where('day').equals('2026-09-12').count()).toBe(1);
  expect(await db.reviewLog.where('cardId').equals('word:hello').count()).toBe(1);

  db.close();
  await Dexie.delete('oxford-english');
});
