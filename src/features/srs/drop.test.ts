/**
 * Cards turn up in the review queue that nobody added: a wrong answer creates one silently, and the
 * lexicon skips them, so the queue is the only place they ever appear. Removing one has to work — and
 * it did not, because the delete was hard: the row stayed on the server and the next pull put the card
 * straight back, so the same card was dismissed over and over.
 */
import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';
import { isDeleted } from '@/features/sync/resolve';
import { dropCard, getDueCards } from './service';

const due = new Date(Date.now() - 86_400_000);

const card = (over: Partial<SrsCard> = {}): SrsCard => {
  const fsrs = createEmptyCard(due);
  return {
    id: 'err:ex1',
    kind: 'phrase',
    front: 'Whose bag is this? — It is ___ . (she)',
    back: 'hers',
    tags: [],
    fromError: true,
    due,
    card: fsrs,
    updatedAt: 1000,
    updatedBy: 'installA',
    ...over,
  };
};

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.srsCards.clear(), db.pending.clear()]);
});

test('a dropped card leaves the queue', async () => {
  await db.srsCards.put(card());
  expect(await getDueCards()).toHaveLength(1);

  await dropCard('err:ex1');

  expect(await getDueCards()).toHaveLength(0);
});

test('the row stays behind as a tombstone, so the removal can reach other devices', async () => {
  await db.srsCards.put(card());

  await dropCard('err:ex1');

  const row = (await db.srsCards.get('err:ex1'))!;
  expect(row).toBeTruthy();
  expect(isDeleted(row)).toBe(true);
});

test('the tombstone outranks its own last edit (H1), so a pull cannot revive it', async () => {
  await db.srsCards.put(card({ updatedAt: 1000 }));

  await dropCard('err:ex1');

  // `deletedAt >= updatedAt` is what makes it deleted. Bumping `updatedAt` on the way out — the obvious
  // thing for a writer to do — reads as edited-after-delete and brings the card back.
  const row = (await db.srsCards.get('err:ex1'))!;
  expect(row.updatedAt).toBe(1000);
  expect(row.deletedAt).toBeGreaterThanOrEqual(row.updatedAt!);
});

test('a card that is already gone is not resurrected as a tombstone', async () => {
  await dropCard('err:missing');

  expect(await db.srsCards.count()).toBe(0);
});

test('other due cards are untouched', async () => {
  await db.srsCards.put(card());
  await db.srsCards.put(card({ id: 'word:apple', kind: 'word', front: 'apple', back: 'яблоко', fromError: false }));

  await dropCard('err:ex1');

  expect((await getDueCards()).map((c) => c.id)).toEqual(['word:apple']);
});
