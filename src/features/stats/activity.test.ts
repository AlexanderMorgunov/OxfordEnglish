import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { addPhraseCard, addWordCard, gradeCard, Rating } from '@/features/srs/service';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { setCurrentReading } from './activity';

const today = async () => (await db.activity.toArray())[0];

beforeEach(async () => {
  await Promise.all([db.activity.clear(), db.reviewLog.clear(), db.srsCards.clear(), db.wordStatus.clear()]);
  setCurrentReading(null);
});

test('a new card counts as a save once, a duplicate does not', async () => {
  await addWordCard('went', 'ходил');
  await addWordCard('went', 'ходил');
  await addPhraseCard('look up', 'искать');
  expect(await today()).toMatchObject({ wordsSaved: 1, phrasesSaved: 1 });
  expect((await db.srsCards.get('word:went'))?.createdAt).toBeGreaterThan(0);
});

test('a save while a book is open is credited to that book', async () => {
  setCurrentReading({ key: 'reader.catalog.alice', title: 'Alice' });
  await addWordCard('rabbit', 'кролик');
  expect((await today())?.books['reader.catalog.alice']).toMatchObject({ title: 'Alice', saved: 1 });
});

test('grading a card logs the review', async () => {
  await addWordCard('go', 'идти');
  await gradeCard('word:go', Rating.Good);
  const log = await db.reviewLog.toArray();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ cardId: 'word:go', rating: Rating.Good });
});

test('moving a word into known counts once, from either setter', async () => {
  const { setStatus, updateStatus } = useVocabStore.getState();
  await setStatus('city', 'learning');
  await setStatus('city', 'known');
  await updateStatus('city', 'known');
  await updateStatus('town', 'known');
  await vi.waitFor(async () => expect((await today())?.learned).toBe(2));
});
