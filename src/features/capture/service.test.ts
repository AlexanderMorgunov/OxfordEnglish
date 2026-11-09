import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import {
  captureDataScope,
  invalidateDataScope,
} from '@/features/account/dataScope';
import { createVocabularyEntry } from '@/features/vocab/vocabulary-mutations';
import { readVocabulary } from '@/features/vocab/vocabulary-data';
import { isDeleted } from '@/features/sync/resolve';
import { useAccount } from '@/features/account/store';
import * as accountConfig from '@/features/account/config';
import { getDueCards } from '@/features/srs/service';
import {
  CaptureConflict,
  readCapturedPhrase,
  saveCapturedPhrase,
} from './service';
import type { CapturePayload } from './links';

vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));
vi.mock('@/features/sync/run', () => ({ nudgeSync: vi.fn() }));
const payload: CapturePayload = {
  term: 'It depends',
  translation: 'Зависит от ситуации',
  context: 'It depends on the weather.',
  source: 'telegram',
};
beforeEach(async () => {
  vi.restoreAllMocks();
  invalidateDataScope();
  useAccount.setState({ status: 'anonymous' });
  await db.open();
  for (const table of [
    db.srsCards,
    db.wordStatus,
    db.translations,
    db.pending,
    db.activity,
    db.reviewLog,
  ])
    await table.clear();
});
afterEach(() => useAccount.setState({ status: 'anonymous' }));
test('opening is read-only; simultaneous saves create one card and preserve the winner', async () => {
  const initial = await readCapturedPhrase(payload.term);
  expect(await db.srsCards.count()).toBe(0);
  const results = await Promise.all([
    saveCapturedPhrase(payload, initial, 'save'),
    saveCapturedPhrase(
      { ...payload, translation: 'Другой перевод' },
      initial,
      'save'
    ),
  ]);
  expect(results.map((r) => r.changed).sort()).toEqual([false, true]);
  expect(await db.srsCards.count()).toBe(1);
  const saved = await db.srsCards.get('phrase:it depends');
  expect(saved?.back).toBe(payload.translation);
  expect(saved?.contextSentence).toBe(payload.context);
  await saveCapturedPhrase(
    { ...payload, translation: 'Попытка замены' },
    initial,
    'save'
  );
  expect(await db.srsCards.get('phrase:it depends')).toEqual(saved);
});
test('dictionary-only saves context and can later add a card without a second translation', async () => {
  const initial = await readCapturedPhrase(payload.term);
  await saveCapturedPhrase(payload, initial, 'save', false);
  expect(await db.srsCards.count()).toBe(0);
  expect((await readVocabulary()).entries[0]).toMatchObject({
    translation: payload.translation,
    context: payload.context,
    hasCard: false,
  });
  const snapshot = await readCapturedPhrase(payload.term);
  await saveCapturedPhrase(
    { ...payload, translation: 'Не применять из ссылки' },
    snapshot,
    'review'
  );
  expect((await db.srsCards.get('phrase:it depends'))?.back).toBe(
    payload.translation
  );
  expect((await db.srsCards.get('phrase:it depends'))?.contextSentence).toBe(
    payload.context
  );
});
test('case, whitespace and curly apostrophe aliases cannot create duplicates', async () => {
  await createVocabularyEntry("I'm ready", 'Готов', '');
  const snapshot = await readCapturedPhrase('I’m  ready');
  expect(snapshot.state).toBe('existing');
  const result = await saveCapturedPhrase(
    { ...payload, term: 'I’m  ready' },
    snapshot,
    'save'
  );
  expect(result.changed).toBe(false);
  expect(await db.srsCards.count()).toBe(1);
});
test('restoration keeps the existing FSRS card, history, meaning and sync identity', async () => {
  await createVocabularyEntry(payload.term, 'Старый перевод', 'Old context');
  const original = await db.srsCards.get('phrase:it depends');
  if (!original) throw Error('Missing fixture');
  const deleted = {
    ...original,
    card: { ...original.card, reps: 17 },
    updatedAt: 20,
    deletedAt: 30,
  };
  await db.srsCards.put(deleted);
  await db.reviewLog.put({
    id: 'review',
    cardId: deleted.id,
    rating: 3,
    ts: 4,
  });
  const initial = await readCapturedPhrase(payload.term);
  expect(initial.state).toBe('deleted');
  await saveCapturedPhrase(payload, initial, 'restore');
  const restored = await db.srsCards.get(deleted.id);
  expect(restored?.card).toEqual(deleted.card);
  expect(restored?.due).toEqual(deleted.due);
  expect(restored?.back).toBe('Старый перевод');
  expect(restored?.creationId).toBe(original.creationId);
  expect(isDeleted(restored ?? {})).toBe(false);
  expect(await db.reviewLog.count()).toBe(1);
});
test('known status survives adding review; ignored stays ignored until an explicit change', async () => {
  await db.wordStatus.put({
    word: 'it depends',
    status: 'known',
    firstSeenAt: 1,
    encounters: 9,
  });
  await db.translations.put({
    word: 'it depends',
    ru: 'Мой перевод',
    source: 'manual',
  });
  await saveCapturedPhrase(
    payload,
    await readCapturedPhrase(payload.term),
    'review'
  );
  expect((await db.wordStatus.get('it depends'))?.status).toBe('known');
  await db.wordStatus.update('it depends', { status: 'ignored' });
  expect(await getDueCards()).toHaveLength(0);
  const ignored = await readCapturedPhrase(payload.term);
  await saveCapturedPhrase(payload, ignored, 'learning');
  expect((await db.wordStatus.get('it depends'))?.status).toBe('learning');
  expect(await getDueCards()).toHaveLength(1);
});
test('edit uses a current snapshot and does not reset schedule', async () => {
  await createVocabularyEntry(payload.term, 'Мой перевод', '');
  const initial = await readCapturedPhrase(payload.term),
    before = initial.card;
  await saveCapturedPhrase(payload, initial, 'edit');
  const updated = await db.srsCards.get('phrase:it depends');
  expect(updated?.card).toEqual(before?.card);
  expect(updated?.due).toEqual(before?.due);
  expect(updated?.back).toBe(payload.translation);
  await expect(
    saveCapturedPhrase({ ...payload, translation: 'stale' }, initial, 'edit')
  ).rejects.toBeInstanceOf(CaptureConflict);
  expect((await db.srsCards.get('phrase:it depends'))?.back).toBe(
    payload.translation
  );
});
test('owner invalidation before and during writes cannot leak a card into the next owner', async () => {
  const initial = await readCapturedPhrase(payload.term),
    scope = captureDataScope();
  invalidateDataScope();
  await expect(
    saveCapturedPhrase(payload, initial, 'save', true, scope)
  ).rejects.toThrow('owner');
  vi.spyOn(db.translations, 'put').mockImplementationOnce(() => {
    invalidateDataScope();
    throw Error('owner');
  });
  await expect(saveCapturedPhrase(payload, initial, 'save')).rejects.toThrow(
    'owner'
  );
  expect(await db.srsCards.count()).toBe(0);
});
test('failed translation storage rolls the dictionary-only write back', async () => {
  const initial = await readCapturedPhrase(payload.term);
  vi.spyOn(db.translations, 'put').mockRejectedValueOnce(new Error('quota'));
  await expect(
    saveCapturedPhrase(payload, initial, 'save', false)
  ).rejects.toThrow('quota');
  expect(await db.wordStatus.count()).toBe(0);
  expect(await db.srsCards.count()).toBe(0);
});

test('signed-in capture and restoration enqueue sync changes with the original identity', async () => {
  vi.spyOn(accountConfig, 'accountsEnabled').mockReturnValue(true);
  useAccount.setState({ status: 'authenticated', accountId: 'capture-test' });
  await saveCapturedPhrase(
    payload,
    await readCapturedPhrase(payload.term),
    'save'
  );
  const card = await db.srsCards.get('phrase:it depends');
  expect(card?.updatedBy).toBeTruthy();
  expect(await db.pending.toArray()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ store: 'srsCards', id: 'phrase:it depends' }),
    ])
  );
  await db.pending.clear();
  await db.srsCards.update('phrase:it depends', {
    deletedAt: Date.now() + 1000,
  });
  await saveCapturedPhrase(
    payload,
    await readCapturedPhrase(payload.term),
    'restore'
  );
  const restored = await db.srsCards.get('phrase:it depends');
  expect(restored?.creationId).toBe(card?.creationId);
  expect(await db.pending.toArray()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ store: 'srsCards', id: 'phrase:it depends' }),
    ])
  );
});
