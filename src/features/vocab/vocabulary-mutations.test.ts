import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { track } from '@/features/analytics/analytics';
import { isDeleted } from '@/features/sync/resolve';
import {
  createVocabularyEntry,
  addVocabularyCard,
  changeVocabularyStatus,
  removeVocabularyCard,
} from './vocabulary-mutations';
import { readVocabulary } from './vocabulary-data';
import { setTranslation } from './manage';
import { useVocabStore } from './vocabStore';

vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(track).mockClear();
  invalidateDataScope();
  await db.open();
  await Promise.all(
    [db.srsCards, db.wordStatus, db.translations, db.pending, db.activity].map(
      (t) => t.clear()
    )
  );
  useVocabStore.setState({ statuses: new Map() });
});

async function firstEntry() {
  const entry = (await readVocabulary()).entries[0];
  if (!entry) throw new Error('Missing test entry');
  return entry;
}

test('simultaneous duplicates create one card/event and cannot replace an answer or schedule', async () => {
  const results = await Promise.all([
    createVocabularyEntry('Curious', 'любознательный', 'A curious child.'),
    createVocabularyEntry('CURIOUS', 'иной ответ', 'Other context.'),
  ]);
  expect(results.map((r) => r.state).sort()).toEqual(['existing', 'saved']);
  const card = await db.srsCards.get('word:curious');
  expect(card?.back).toBe('любознательный');
  expect(await db.srsCards.count()).toBe(1);
  expect(track).toHaveBeenCalledOnce();
  expect(await createVocabularyEntry('curious', 'перезаписать', '')).toEqual({
    state: 'existing',
    key: 'curious',
  });
  expect(await db.srsCards.get('word:curious')).toEqual(card);
});

test('translation write failure rolls back the whole creation, permitting a real retry', async () => {
  const write = vi
    .spyOn(db.translations, 'put')
    .mockRejectedValueOnce(new Error('Full'));
  await expect(createVocabularyEntry('quiet', 'тихий', '')).rejects.toThrow();
  expect(await db.srsCards.count()).toBe(0);
  expect(track).not.toHaveBeenCalled();
  write.mockRestore();
  expect((await createVocabularyEntry('quiet', 'тихий', '')).state).toBe(
    'saved'
  );
});

test('cancellation during the transaction rolls back the card and translation', async () => {
  let active = true;
  const put = db.translations.put.bind(db.translations);
  vi.spyOn(db.translations, 'put').mockImplementation((...args) =>
    put(...args).then((result) => {
      active = false;
      return result;
    })
  );
  await expect(
    createVocabularyEntry('quiet', 'тихий', '', undefined, () => active)
  ).rejects.toThrow();
  expect(await db.srsCards.count()).toBe(0);
  expect(await db.translations.count()).toBe(0);
  expect(track).not.toHaveBeenCalled();
});

test('status-only known term requires explicit review membership and keeps its status after removal', async () => {
  await db.wordStatus.put({
    word: 'quiet',
    status: 'known',
    firstSeenAt: 12,
    encounters: 7,
  });
  expect((await createVocabularyEntry('QUIET', 'тихий', '')).state).toBe(
    'existing'
  );
  const entry = await firstEntry();
  await addVocabularyCard(entry);
  const withCard = await firstEntry();
  expect(withCard.status).toBe('known');
  await removeVocabularyCard(withCard);
  const removed = await readVocabulary();
  expect(removed.entries[0]!).toMatchObject({
    key: 'quiet',
    status: 'known',
    hasCard: false,
  });
  expect(removed.deleted.has('quiet')).toBe(true);
  expect(isDeleted((await db.srsCards.get('word:quiet'))!)).toBe(true);
  await expect(addVocabularyCard(removed.entries[0]!)).rejects.toThrow();
  expect((await db.wordStatus.get('quiet'))?.encounters).toBe(7);
});

test('card-only removal leaves a tombstone and ordinary Add cannot resurrect it', async () => {
  await createVocabularyEntry('take care', 'береги себя', 'Take care.');
  await removeVocabularyCard(await firstEntry());
  expect((await readVocabulary()).entries).toEqual([]);
  expect((await createVocabularyEntry('TAKE CARE', 'заново', '')).state).toBe(
    'deleted'
  );
});

test('known/hidden/learning update only the status, with the existing review schedule intact', async () => {
  await createVocabularyEntry('curious', 'любознательный', '');
  const entry = await firstEntry(),
    card = await db.srsCards.get('word:curious');
  for (const status of ['known', 'ignored', 'learning'] as const)
    await changeVocabularyStatus(entry, status);
  expect(await db.srsCards.get('word:curious')).toEqual(card);
  expect((await db.wordStatus.get('curious'))?.encounters).toBe(0);
});

test('status storage failure is reported and never becomes a false optimistic success', async () => {
  await db.wordStatus.put({
    word: 'quiet',
    status: 'learning',
    firstSeenAt: 12,
    encounters: 7,
  });
  useVocabStore.setState({ statuses: new Map([['quiet', 'learning']]) });
  const entry = await firstEntry();
  vi.spyOn(db.wordStatus, 'put').mockRejectedValueOnce(new Error('Full'));
  await expect(changeVocabularyStatus(entry, 'known')).rejects.toThrow();
  expect(useVocabStore.getState().statuses.get('quiet')).toBe('learning');
  expect((await db.wordStatus.get('quiet'))?.status).toBe('learning');
});

test('an old owner cannot create, edit, classify or remove entries', async () => {
  await createVocabularyEntry('quiet', 'тихий', '');
  const entry = await firstEntry();
  await expect(
    createVocabularyEntry('other', 'другой', '', undefined, () => false)
  ).rejects.toThrow();
  expect(await setTranslation(entry, 'новый', () => false)).toBe(false);
  await expect(
    changeVocabularyStatus(entry, 'known', () => false)
  ).rejects.toThrow();
  await expect(removeVocabularyCard(entry, () => false)).rejects.toThrow();
  expect((await db.srsCards.get('word:quiet'))?.back).toBe('тихий');
});

test('a concurrent answer change or manual clearing cannot be overwritten by an old editor', async () => {
  await createVocabularyEntry('quiet', 'тихий', '');
  const entry = await firstEntry();
  await db.srsCards.update('word:quiet', { back: 'quiet' });
  await db.translations.put({ word: 'quiet', ru: '', source: 'manual' });
  expect(await setTranslation(entry, 'старый черновик')).toBe(false);
  expect((await db.srsCards.get('word:quiet'))?.back).toBe('quiet');
});

test('real snapshot excludes grammar/error/deleted cards, uses creation date and keeps phrase identity after card removal', async () => {
  const card = createEmptyCard(new Date(99));
  await db.srsCards.bulkPut([
    {
      id: 'word:quiet',
      kind: 'word',
      front: 'quiet',
      back: 'тихий',
      tags: [],
      card,
      due: card.due,
      createdAt: 12,
    },
    {
      id: 'grammar:g',
      kind: 'grammar-pattern',
      front: 'g',
      back: 'g',
      tags: [],
      card,
      due: card.due,
    },
    {
      id: 'error:e',
      kind: 'word',
      front: 'error',
      back: 'error',
      fromError: true,
      tags: [],
      card,
      due: card.due,
    },
  ]);
  await db.wordStatus.put({
    word: 'take care',
    status: 'known',
    firstSeenAt: 9,
    encounters: 1,
  });
  expect((await readVocabulary()).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: 'quiet', sortAt: 12 }),
      expect.objectContaining({ key: 'take care', kind: 'phrase' }),
    ])
  );
  expect((await readVocabulary()).entries).toHaveLength(2);
});

test('database read failure is a rejection, never an invented empty vocabulary', async () => {
  vi.spyOn(db.wordStatus, 'toArray').mockRejectedValueOnce(
    new Error('Unavailable')
  );
  await expect(readVocabulary()).rejects.toThrow('Unavailable');
});
