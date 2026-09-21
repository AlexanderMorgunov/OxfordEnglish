/**
 * Clearing the mistake pile in one go.
 *
 * A wrong answer creates a review card, which is right card-by-card and unusable in bulk: a few weeks
 * of practice had produced 321 of them, removable only one at a time. The danger of a bulk control is
 * the obvious one — it must take the mistake cards and nothing else, because the saved words next to
 * them are work the user did on purpose and cannot get back.
 */
import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';
import { isDeleted } from '@/features/sync/resolve';
import { countErrorCards, dropAllErrorCards, getDueCards } from './service';

const due = new Date(Date.now() - 86_400_000);

const card = (id: string, over: Partial<SrsCard> = {}): SrsCard => ({
  id,
  kind: 'phrase',
  front: 'Whose bag is this? — It is ___ . (she)',
  back: 'hers',
  tags: [],
  due,
  card: createEmptyCard(due),
  updatedAt: 1000,
  updatedBy: 'installA',
  ...over,
});

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.srsCards.clear(), db.pending.clear()]);
});

test('takes every mistake card and leaves the saved words alone', async () => {
  await db.srsCards.bulkPut([
    card('err:ex1', { fromError: true }),
    card('err:ex2', { fromError: true }),
    card('word:hers', { kind: 'word', front: 'hers', fromError: false }),
    card('phrase:by the way', { front: 'by the way' }), // saved by hand: no flag at all
  ]);

  const removed = await dropAllErrorCards();

  expect(removed).toBe(2);
  expect((await getDueCards()).map((c) => c.id).sort()).toEqual(['phrase:by the way', 'word:hers']);
});

test('removals are tombstones, so they reach the account other devices', async () => {
  await db.srsCards.bulkPut([card('err:ex1', { fromError: true })]);

  await dropAllErrorCards();

  const row = (await db.srsCards.get('err:ex1'))!;
  expect(row).toBeTruthy();
  expect(isDeleted(row)).toBe(true);
  // H1: bumping `updatedAt` would read as edited-after-delete and the next pull would revive the row.
  expect(row.updatedAt).toBe(1000);
});

test('cards already removed are not counted again', async () => {
  await db.srsCards.bulkPut([
    card('err:ex1', { fromError: true, deletedAt: Date.now() }),
    card('err:ex2', { fromError: true }),
  ]);

  expect(await countErrorCards()).toBe(1);
  expect(await dropAllErrorCards()).toBe(1);
});

test('a mistake card that is not due yet still goes', async () => {
  // The count and the sweep are about the pile, not about today: leaving the not-yet-due ones behind
  // would clear the screen and hand them back next week, which is the complaint all over again.
  const later = new Date(Date.now() + 30 * 86_400_000);
  await db.srsCards.bulkPut([
    card('err:soon', { fromError: true }),
    card('err:later', { fromError: true, due: later, card: createEmptyCard(later) }),
  ]);

  expect(await countErrorCards()).toBe(2);
  expect(await dropAllErrorCards()).toBe(2);
  expect(await countErrorCards()).toBe(0);
});

test('nothing to clear is not an error', async () => {
  expect(await countErrorCards()).toBe(0);
  expect(await dropAllErrorCards()).toBe(0);
});
