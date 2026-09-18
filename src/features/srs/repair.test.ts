/**
 * Every save path writes `back: translation ?? term`, so a lookup that was rate-limited, offline or
 * simply missing leaves the term as its own translation — which the review renders as a bare dash.
 *
 * The reveal already retried the lookup, but only into component state: the same card asked the network
 * on every showing and went back to a dash whenever it could not reach it. This is the write-back.
 */
import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';
import { canPronounce, repairCardBack } from './service';

const card = (over: Partial<SrsCard> = {}): SrsCard => {
  const fsrs = createEmptyCard(new Date(0));
  return {
    id: 'word:sources',
    kind: 'word',
    front: 'sources',
    back: 'sources',
    tags: [],
    due: fsrs.due,
    card: fsrs,
    ...over,
  };
};

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.srsCards.clear(), db.pending.clear()]);
});

test('a term that is its own translation gets the looked-up one written in', async () => {
  await db.srsCards.put(card());

  expect(await repairCardBack('word:sources', 'источники')).toBe(true);
  expect((await db.srsCards.get('word:sources'))?.back).toBe('источники');
});

test('the repair is written so it can reach the account’s other devices', async () => {
  await db.srsCards.put(card({ updatedAt: undefined, updatedBy: undefined }));

  await repairCardBack('word:sources', 'источники');

  // Stamped, i.e. written through the sync layer rather than straight to Dexie. Written raw it would be
  // invisible to the push, so the dash would stay on every other device and each of them would keep
  // re-asking the network for the same word. (The dirty queue itself only fills while signed in.)
  const row = (await db.srsCards.get('word:sources'))!;
  expect(row.updatedAt).toBeTruthy();
  expect(row.updatedBy).toBeTruthy();
});

test('a card that already has a translation is never overwritten', async () => {
  await db.srsCards.put(card({ back: 'источники' }));

  expect(await repairCardBack('word:sources', 'что-то другое')).toBe(false);
  expect((await db.srsCards.get('word:sources'))?.back).toBe('источники');
});

test('a lookup that echoed the term back is not a translation', async () => {
  await db.srsCards.put(card());

  // MyMemory answers with the source text for words it does not know, which would "repair" the card
  // into the same dash it already shows while marking it as done.
  expect(await repairCardBack('word:sources', 'sources')).toBe(false);
  expect(await db.pending.count()).toBe(0);
});

test('an empty answer changes nothing', async () => {
  await db.srsCards.put(card());

  expect(await repairCardBack('word:sources', '   ')).toBe(false);
  expect((await db.srsCards.get('word:sources'))?.back).toBe('sources');
});

test('a card that is gone is not resurrected', async () => {
  expect(await repairCardBack('word:vanished', 'исчез')).toBe(false);
  expect(await db.srsCards.count()).toBe(0);
});

/**
 * The pronounce button was limited to `kind === 'word'`, so every phrase the user saved was silent —
 * and phrases are where stress and linking live, which is the point of hearing them at all.
 */
test('saved words and phrases can be pronounced', () => {
  expect(canPronounce({ kind: 'word', fromError: false })).toBe(true);
  expect(canPronounce({ kind: 'phrase', fromError: false })).toBe(true);
  expect(canPronounce({ kind: 'word', fromError: undefined })).toBe(true);
});

test('a mistake card is not, because its front is the exercise', () => {
  // Gap-fills are full of underscores and translate prompts are in Russian; an English voice reading
  // either is noise, not listening practice.
  expect(canPronounce({ kind: 'phrase', fromError: true })).toBe(false);
  expect(canPronounce({ kind: 'word', fromError: true })).toBe(false);
});

test('a grammar pattern is a formula, not speech', () => {
  expect(canPronounce({ kind: 'grammar-pattern', fromError: false })).toBe(false);
});
