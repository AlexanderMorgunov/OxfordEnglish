import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { db, type SrsCard } from '@/db/db';
import { buildSnapshot, applySnapshot, hasProgress } from './snapshot';
import { encodeSnapshot, decodeSnapshot } from './codec';

const emptyCard = (): SrsCard['card'] =>
  ({
    due: new Date(1000),
    stability: 1,
    difficulty: 1,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    last_review: new Date(1000),
  }) as SrsCard['card'];

async function clearAll() {
  await Promise.all(db.tables.map((t) => t.clear()));
  localStorage.clear();
}

async function seed() {
  await db.srsCards.add({
    id: 'c1', kind: 'word', front: 'cat', back: 'кот', tags: ['v'],
    due: new Date(5000), card: emptyCard(),
  });
  await db.wordStatus.add({ word: 'cat', status: 'learning', firstSeenAt: 1, encounters: 2 });
  await db.attempts.add({ exerciseId: 'e1', tags: [], correct: true, userAnswer: 'a', attemptNumber: 1, timestamp: 1, usedHint: false, usedAI: false });
  await db.translations.add({ word: 'cat', ru: 'кот', source: 'dict' });
  await db.feedbackOutbox.add({ body: { message: 'hi' }, createdAt: 1 });
  await db.books.add({ id: 'b1', title: 'T', format: 'epub', addedAt: 1, chapterCount: 3, lastChapter: 1 });
  await db.bookmarks.add({ id: 'bm-cat', bookKey: 'reader.catalog.alice', page: 0, paragraph: 1, pageId: 'p', snippet: 's', createdAt: 1 });
  await db.bookmarks.add({ id: 'bm-imp', bookKey: 'reader.abc-uuid', page: 0, paragraph: 1, pageId: 'p', snippet: 's', createdAt: 1 });
  localStorage.setItem('oxford-learner', JSON.stringify({ level: 'A2', recommendedUnitId: 'u3', placementDone: true }));
  localStorage.setItem('oxford-ai-config', JSON.stringify({ provider: 'groq', apiKey: 'SECRET', model: 'm' }));
  localStorage.setItem('reader.catalog.alice.pos.0', '120');
  localStorage.setItem('reader.abc-uuid.pos.0', '999');
  localStorage.setItem('analytics.anonId', 'device-local');
}

beforeEach(clearAll);

test('snapshot excludes apiKey, imported-book bookmarks, and device-local keys', async () => {
  await seed();
  const snap = await buildSnapshot();

  expect(snap.booksCount).toBe(1);
  expect(snap.dexie.bookmarks?.map((b) => b.id)).toEqual(['bm-cat']); // imported bookmark dropped
  expect(snap.local['oxford-learner']).toBeDefined();
  expect(snap.local['reader.catalog.alice.pos.0']).toBe('120');
  expect(snap.local['reader.abc-uuid.pos.0']).toBeUndefined(); // imported scroll pos dropped
  expect(snap.local['analytics.anonId']).toBeUndefined(); // device-local, never migrated
  const ai = JSON.parse(snap.local['oxford-ai-config']!) as Record<string, unknown>;
  expect(ai.apiKey).toBeUndefined(); // secret stripped
  expect(ai.provider).toBe('groq');
});

test('encode → decode → apply round-trips into a fresh profile, reviving FSRS dates', async () => {
  await seed();
  const encoded = await encodeSnapshot(await buildSnapshot());
  await clearAll();

  const snap = await decodeSnapshot(encoded);
  expect(await applySnapshot(snap)).toBe('imported');

  expect(await db.srsCards.count()).toBe(1);
  const card = await db.srsCards.get('c1');
  expect(card?.due).toBeInstanceOf(Date); // revived, not a string
  expect(await db.wordStatus.count()).toBe(1);
  expect(await db.attempts.count()).toBe(1);
  expect(await db.feedbackOutbox.count()).toBe(1);
  expect(await db.bookmarks.count()).toBe(1); // catalog only
  expect(await db.books.count()).toBe(0); // books table not migrated in v1
  expect(localStorage.getItem('oxford-learner')).toContain('A2');
  expect(localStorage.getItem('reader.catalog.alice.pos.0')).toBe('120');
});

test('decode rejects a truncated fragment instead of importing partial data', async () => {
  const encoded = await encodeSnapshot(await buildSnapshot());
  const clipped = encoded.slice(0, encoded.length - 10);
  await expect(decodeSnapshot(clipped)).rejects.toThrow(/truncated/);
});

test('applySnapshot skips when the target already has progress (no clobber)', async () => {
  await seed();
  const snap = await buildSnapshot();
  // Target already has its own progress:
  await clearAll();
  await db.srsCards.add({ id: 'mine', kind: 'word', front: 'own', back: 'своё', tags: [], due: new Date(1), card: emptyCard() });
  expect(await hasProgress()).toBe(true);

  expect(await applySnapshot(snap)).toBe('skipped-nonempty');
  expect(await db.srsCards.count()).toBe(1);
  expect((await db.srsCards.get('mine'))?.front).toBe('own'); // untouched
});

test('applySnapshot never overwrites an existing localStorage key', async () => {
  await seed();
  const snap = await buildSnapshot();
  await clearAll();
  localStorage.setItem('oxford-learner', JSON.stringify({ level: 'B1', recommendedUnitId: 'u9', placementDone: true }));

  await applySnapshot(snap);
  expect(localStorage.getItem('oxford-learner')).toContain('B1'); // kept the target's own value
});
