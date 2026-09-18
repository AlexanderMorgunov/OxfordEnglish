/**
 * The upgrade a shipped install ACTUALLY takes: v7 → v8.
 *
 * v7 (per-device stats) reached production before the sync branch, which is why the sync migration had to
 * be renumbered to v8. So real installs sit at v7 with v7 data already in them, and the only upgrade that
 * runs for them is v8's.
 *
 * Nothing covered that. `migration-chain.test.ts` starts at v6 and writes `activity`/`reviewLog` rows
 * AFTER the upgrade — which proves the tables are usable, not that data already in them survives. And
 * `features/sync/migration.test.ts` starts at v6 too. v8's `.stores()` does not mention `activity` or
 * `reviewLog` (a Dexie version lists only the tables it CHANGES), so if that inheritance ever broke,
 * every user's reading stats and review history would vanish on update, silently and unrecoverably.
 *
 * Own file because `db` opens lazily and must not have been opened before the seed.
 */
import 'fake-indexeddb/auto';
import { test, expect } from 'vitest';
import Dexie from 'dexie';
import { createEmptyCard } from 'ts-fsrs';
import { db, INSTALL_ROW, EPOCH_SENTINEL } from './db';

/** A database at exactly v7, with rows in both the old tables and the ones v7 introduced. */
async function seedV7() {
  const v7 = new Dexie('oxford-english');
  v7.version(1).stores({
    attempts: '++id, exerciseId, timestamp, *tags',
    wordStatus: 'word, status',
    srsCards: 'id, due, *tags',
    checkpoints: '++id, unitId, timestamp',
    translations: 'word',
  });
  v7.version(2).stores({ books: 'id, addedAt' });
  v7.version(3).stores({ catalogCache: 'id, cachedAt' });
  v7.version(4).stores({ analyticsQueue: '++id, ts' });
  v7.version(5).stores({ feedbackOutbox: '++id, createdAt' });
  v7.version(6).stores({ bookmarks: 'id, bookKey, createdAt, [bookKey+page+paragraph]' });
  v7.version(7).stores({ activity: 'id, day', reviewLog: 'id, ts, cardId' });
  await v7.open();
  expect(v7.verno).toBe(7);

  const card = createEmptyCard(new Date(0));
  card.last_review = new Date(4000);
  await v7.table('wordStatus').put({ word: 'apple', status: 'known', firstSeenAt: 3000, encounters: 4 });
  await v7.table('srsCards').put({ id: 'word:apple', kind: 'word', front: 'apple', back: 'яблоко', tags: [], due: new Date(9_999_999), card });
  await v7.table('attempts').add({ exerciseId: 'e1', tags: ['t'], correct: true, userAnswer: 'x', attemptNumber: 1, timestamp: 1000, usedHint: false, usedAI: false });
  await v7.table('books').add({ id: 'bk1', title: 'T', format: 'epub', addedAt: 5000, chapterCount: 3, lastChapter: 2 });
  await v7.table('bookmarks').add({ id: 'bm1', bookKey: 'reader.x', page: 0, paragraph: 1, pageId: 'p', snippet: 's', createdAt: 6000 });

  // The v7 data itself — the part no existing test has present before the v8 upgrade.
  await v7.table('activity').put({
    id: '2026-09-12:devA', day: '2026-09-12', readSec: 900, readWords: 1200,
    wordsSaved: 7, phrasesSaved: 2, learned: 5, books: { 'reader.bk1': { title: 'T', sec: 900, words: 1200, saved: 7 } },
  });
  await v7.table('activity').put({
    id: '2026-09-13:devA', day: '2026-09-13', readSec: 60, readWords: 90,
    wordsSaved: 0, phrasesSaved: 0, learned: 1, books: {},
  });
  await v7.table('reviewLog').add({ id: 'r1', cardId: 'word:apple', rating: 3, ts: 7000 });
  await v7.table('reviewLog').add({ id: 'r2', cardId: 'word:apple', rating: 4, ts: 8000 });
  v7.close();
}

test('v7 → v8 keeps the stats a real install already has, and backfills sync-meta', async () => {
  await seedV7();

  await db.open(); // only v8's upgrade runs from here
  expect(db.verno).toBe(8);

  // The whole point: v8 never names these tables, so they survive only by Dexie inheriting them.
  expect(await db.activity.count()).toBe(2);
  const day = (await db.activity.get('2026-09-12:devA'))!;
  expect(day.readSec).toBe(900);
  expect(day.books['reader.bk1']?.words).toBe(1200); // nested objects intact, not just the row
  expect(await db.reviewLog.count()).toBe(2);
  expect((await db.reviewLog.where('cardId').equals('word:apple').toArray()).map((r) => r.rating).sort()).toEqual([3, 4]);

  // Their indexes still work — a surviving row behind a lost index reads as missing.
  expect(await db.activity.where('day').equals('2026-09-13').count()).toBe(1);
  expect(await db.reviewLog.where('ts').between(6500, 7500).count()).toBe(1);

  // And the v8 backfill ran for a v7 starting point exactly as it does from v6 (F11: natural creation
  // time, never now()).
  const installId = (await db.syncState.get(INSTALL_ROW))?.installId;
  expect(installId).toBeTruthy();

  const word = (await db.wordStatus.get('apple'))!;
  expect(word.updatedAt).toBe(3000); // = firstSeenAt
  expect(word.statusUpdatedAt).toBe(3000);
  expect(word.updatedBy).toBe(installId);

  expect((await db.books.get('bk1'))!.updatedAt).toBe(5000); // = addedAt
  expect((await db.bookmarks.get('bm1'))!.updatedAt).toBe(6000); // = createdAt
  expect((await db.srsCards.get('word:apple'))!.updatedAt).toBe(4000); // = card.last_review

  const attempt = (await db.attempts.toArray())[0]!;
  expect(attempt.updatedAt).toBe(1000); // = timestamp
  expect(attempt.syncId).toContain(installId!);

  // Nothing was stamped with wall-clock time: every backfilled row traces to its own creation.
  const stamps = [word.updatedAt, (await db.books.get('bk1'))!.updatedAt, attempt.updatedAt];
  expect(stamps.every((t) => t != null && t !== EPOCH_SENTINEL && t < 100_000)).toBe(true);

  db.close();
  await Dexie.delete('oxford-english');
});
