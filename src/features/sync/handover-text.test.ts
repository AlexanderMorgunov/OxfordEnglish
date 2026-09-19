/**
 * Two stores were left out when the device-handover release was built, and both hold the previous
 * reader's own words (queue item 16).
 *
 * `db.translations` is keyed by whatever was looked up, and three paths put a whole sentence in that
 * key: the Simplify and grammar lenses, the in-context AI lookup, and phrase translation. So a row can
 * be a verbatim line out of the book somebody was reading — stronger than the book TITLES that justify
 * clearing `activity`. `db.feedbackOutbox` holds support messages that never sent.
 *
 * Clearing the whole cache would be the easy answer and the wrong one: plain word translations are
 * impersonal and costly to refetch, since MyMemory is rate-limited per IP.
 */
import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { db } from '@/db/db';
import { releasePreviousAccountData, wipeSyncedData } from './engine';

const SENTENCE = 'The Odyssey of Captain Blood was derived from various sources.';

const seed = async () => {
  await db.translations.bulkPut([
    { word: 'sources', ru: 'источники', source: 'mymemory' },
    { word: 'dizzy', ru: 'в голове мутится', source: 'manual' },
    { word: `lens:simplify:v1:B1:deepseek:${SENTENCE}`, ru: '', en: 'It came from many places.', source: 'lens-simplify' },
    { word: `lens:grammar:v1:B1:deepseek:${SENTENCE}`, ru: 'Разбор', source: 'lens-grammar' },
    { word: `ai:deepseek:sources|@|${SENTENCE}`, ru: 'источники', source: 'ai' },
    { word: 'fool around with', ru: 'валять дурака', source: 'mymemory' },
  ]);
  await db.feedbackOutbox.add({ body: { message: 'I think the app crashed when I opened my diary' }, createdAt: 1 });
};

const keys = async () => (await db.translations.toCollection().primaryKeys()).map(String);

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.translations.clear(), db.feedbackOutbox.clear(), db.activity.clear(), db.reviewLog.clear()]);
});

test('a sentence from the previous reader’s book does not stay on the device', async () => {
  await seed();

  await releasePreviousAccountData();

  expect((await keys()).some((k) => k.includes(SENTENCE))).toBe(false);
});

test('every path that embeds a sentence is covered, not just the one that named it', async () => {
  await seed();

  await releasePreviousAccountData();

  // The lenses were the obvious pair; the in-context AI lookup hides its sentence after a `|@|`, and a
  // translated phrase is simply its own key with no prefix at all.
  const left = await keys();
  expect(left.some((k) => k.startsWith('lens:'))).toBe(false);
  expect(left.some((k) => k.startsWith('ai:'))).toBe(false);
  expect(left).not.toContain('fool around with');
});

test('plain word translations survive, because they are nobody’s writing', async () => {
  await seed();

  await releasePreviousAccountData();

  // Throwing these away too would make the next person refetch a dictionary they never wrote, against a
  // per-IP rate limit they now share.
  expect((await keys()).sort()).toEqual(['dizzy', 'sources']);
});

test('unsent feedback goes with the device', async () => {
  await seed();

  await releasePreviousAccountData();

  expect(await db.feedbackOutbox.count()).toBe(0);
});

test('an ordinary logout keeps all of it', async () => {
  await seed();

  await wipeSyncedData();

  // None of this is synced, so a sign-out that cleared it would be deleting the user's own cache and
  // their unsent message with no way to get either back.
  expect(await db.translations.count()).toBe(6);
  expect(await db.feedbackOutbox.count()).toBe(1);
});
