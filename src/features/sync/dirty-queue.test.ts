import 'fake-indexeddb/auto';
import { vi, test, expect, beforeEach } from 'vitest';

// Without these two the whole file is vacuous: `dirty()` in local.ts returns on its first line unless
// accounts are configured AND a session is authenticated, and no vitest run sets VITE_API_BASE. Gutting
// `dirty()` entirely used to leave the suite green — nothing marked dirty, nothing queued, no failure.
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true, API_BASE: 'https://api.test' }));
vi.mock('@/features/account/store', () => ({
  useAccount: { getState: () => ({ status: 'authenticated', accountId: 'acc-1' }) },
}));
// Mocked rather than faked with timers: `nudgeSync` schedules a real 3s push into a real sync cycle and
// leaks module-level timer state across files.
vi.mock('./run', () => ({ nudgeSync: vi.fn() }));

import { db } from '@/db/db';
import { nudgeSync } from './run';
import { addAttempt, addBook, addBookmark, addCheckpoint, putSrsCard, putWordStatus, softDeleteBook } from './local';

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.pending.clear(), db.books.clear(), db.srsCards.clear(), db.wordStatus.clear(), db.bookmarks.clear()]);
  vi.mocked(nudgeSync).mockClear();
});

const keys = async () => (await db.pending.toArray()).map((p) => p.key).sort();

test('adding a book queues it under its own id and asks for a push', async () => {
  await addBook({ id: 'bk-1', title: 'T', author: 'A', format: 'epub', addedAt: 1, chapterCount: 1, lastChapter: 0 });
  expect(await keys()).toEqual(['books:bk-1']);
  expect(nudgeSync).toHaveBeenCalled();
});

test('a review, a word and a bookmark each queue under their own key', async () => {
  await putSrsCard({ id: 'w:cat', kind: 'word', ref: 'cat', due: 0, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: 0, lastReview: 0 } as never);
  await putWordStatus({ word: 'cat', status: 'learning', encounters: 1, firstSeenAt: 1 } as never);
  await addBookmark({ id: 'bm-1', bookId: 'bk-1', chapter: 0, createdAt: 1 } as never);
  expect(await keys()).toEqual(['bookmarks:bm-1', 'srsCards:w:cat', 'wordStatus:cat']);
});

test('a soft delete is a change like any other and still queues', async () => {
  await addBook({ id: 'bk-2', title: 'T', author: 'A', format: 'epub', addedAt: 1, chapterCount: 1, lastChapter: 0 });
  await db.pending.clear();
  await softDeleteBook('bk-2');
  expect(await keys()).toEqual(['books:bk-2']);
});

// Append-only stores key on `syncId`, not on the Dexie autoincrement id. local.ts carries an explicit
// guard against a missing syncId enqueuing as the literal `undefined` and merging every such row into
// one — that guard had no coverage at all.
test('append-only rows queue under a syncId, never a shared placeholder', async () => {
  await addAttempt({ dayId: 'u01.d01', exerciseId: 'e1', correct: true, at: 1 } as never);
  await addAttempt({ dayId: 'u01.d01', exerciseId: 'e2', correct: false, at: 2 } as never);
  await addCheckpoint({ unitId: 'u01', score: 5, total: 5, at: 3 } as never);

  const rows = await db.pending.toArray();
  expect(rows).toHaveLength(3);
  for (const r of rows) {
    expect(r.syncId).toBeTruthy();
    expect(r.key).toBe(`${r.store}:${r.syncId}`);
    expect(r.key).not.toContain('undefined');
  }
  expect(new Set(rows.map((r) => r.key)).size).toBe(3);
});
