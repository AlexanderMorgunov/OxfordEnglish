import 'fake-indexeddb/auto';
import { test, expect } from 'vitest';
import Dexie from 'dexie';
import { createEmptyCard } from 'ts-fsrs';
import { db, INSTALL_ROW } from '@/db/db';
import { getInstallId } from './meta';

/** Seed a real v6 database with the pre-sync schema + rows, then let the app's Dexie run the v7 upgrade
 *  and assert the sync-meta backfill. This must seed BEFORE the app `db` opens (it opens lazily). */
async function seedV6() {
  const legacy = new Dexie('oxford-english');
  legacy.version(1).stores({ attempts: '++id, exerciseId, timestamp, *tags', wordStatus: 'word, status', srsCards: 'id, due, *tags', checkpoints: '++id, unitId, timestamp', translations: 'word' });
  legacy.version(2).stores({ books: 'id, addedAt' });
  legacy.version(3).stores({ catalogCache: 'id, cachedAt' });
  legacy.version(4).stores({ analyticsQueue: '++id, ts' });
  legacy.version(5).stores({ feedbackOutbox: '++id, createdAt' });
  legacy.version(6).stores({ bookmarks: 'id, bookKey, createdAt, [bookKey+page+paragraph]' });
  await legacy.open();
  await legacy.table('attempts').add({ exerciseId: 'e1', tags: ['t'], correct: true, userAnswer: 'x', attemptNumber: 1, timestamp: 1000, usedHint: false, usedAI: false });
  await legacy.table('checkpoints').add({ unitId: 'u01', timestamp: 2000, score: 5, total: 6, tagBreakdown: [] });
  await legacy.table('wordStatus').put({ word: 'apple', status: 'known', firstSeenAt: 3000, encounters: 4 });
  const card = createEmptyCard(new Date(0));
  card.last_review = new Date(4000);
  await legacy.table('srsCards').put({ id: 'word:apple', kind: 'word', front: 'apple', back: 'яблоко', tags: [], due: new Date(9_999_999), card });
  await legacy.table('books').add({ id: 'bk1', title: 'T', format: 'epub', addedAt: 5000, chapterCount: 3, lastChapter: 0 });
  await legacy.table('bookmarks').add({ id: 'bm1', bookKey: 'reader.x', page: 0, paragraph: 1, pageId: 'p', snippet: 's', createdAt: 6000 });
  legacy.close();
}

test('v6 → v7 backfills sync-meta from natural creation time (never now()) and seeds an install id', async () => {
  await seedV6();
  await db.open(); // triggers the v7 upgrade

  const meta = await db.syncState.get(INSTALL_ROW);
  expect(meta?.installId).toBeTruthy();
  const installId = meta!.installId!;

  const attempt = (await db.attempts.toArray())[0]!;
  expect(attempt.updatedAt).toBe(1000); // = timestamp
  expect(attempt.updatedBy).toBe(installId);
  expect(attempt.syncId).toBe(`${installId}:a${attempt.id}`);

  const checkpoint = (await db.checkpoints.toArray())[0]!;
  expect(checkpoint.updatedAt).toBe(2000);
  expect(checkpoint.syncId).toBe(`${installId}:c${checkpoint.id}`);

  const status = (await db.wordStatus.get('apple'))!;
  expect(status.statusUpdatedAt).toBe(3000); // = firstSeenAt
  expect(status.updatedAt).toBe(3000);

  const srs = (await db.srsCards.get('word:apple'))!;
  expect(srs.updatedAt).toBe(4000); // = card.last_review, NOT the future `due`

  const book = (await db.books.get('bk1'))!;
  expect(book.updatedAt).toBe(5000); // = addedAt

  const bookmark = (await db.bookmarks.get('bm1'))!;
  expect(bookmark.updatedAt).toBe(6000); // = createdAt

  // getInstallId() returns the migration-seeded id, not a fresh one.
  expect(await getInstallId()).toBe(installId);

  db.close();
});
