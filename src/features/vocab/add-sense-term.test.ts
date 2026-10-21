import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { addSenseTerm } from './add-sense-term';
import { invalidateDataScope } from '@/features/account/dataScope';
import { gradeCard, Rating } from '@/features/srs/service';

beforeEach(async () => { await db.open(); await Promise.all([db.srsCards.clear(), db.translations.clear(), db.pending.clear(), db.activity.clear(), db.reviewLog.clear()]); });
afterEach(() => vi.restoreAllMocks());
test('creates a new selected answer/context atomically, counts once and permits ordinary review', async () => {
  const result = await addSenseTerm('bank', 'берег', 'We sat on the bank.', 'noun');
  expect(result.state).toBe('saved');
  const row = await db.srsCards.get('word:bank');
  expect(row?.back).toBe('берег'); expect(row?.contextSentence).toBe('We sat on the bank.');
  expect(row?.partOfSpeech).toBe('noun');
  expect(row?.contextGloss).toBeUndefined(); expect(row?.card.reps).toBe(0);
  expect((await db.translations.get('bank'))?.source).toBe('manual');
  expect((await db.activity.toArray()).reduce((sum, day) => sum + day.wordsSaved, 0)).toBe(1);
  if (!row) throw new Error('Missing new card');
  await gradeCard(row.id, Rating.Good);
  const before = await db.srsCards.get('word:bank');
  const counts = await db.activity.toArray();
  expect((await addSenseTerm('bank', 'банк', 'I use the bank.', 'verb')).state).toBe('existing');
  expect(await db.srsCards.get('word:bank')).toEqual(before);
  expect(await db.activity.toArray()).toEqual(counts);
  expect(await db.reviewLog.count()).toBe(1);
});
test('two simultaneous saves create exactly one card and manual translation', async () => {
  const results = await Promise.all([addSenseTerm('bank', 'берег', 'A bank.'), addSenseTerm('bank', 'банк', 'A bank.')]);
  expect(results.map(result => result.state).sort()).toEqual(['existing', 'saved']);
  expect(await db.srsCards.count()).toBe(1);
  expect((await db.activity.toArray()).reduce((sum, day) => sum + day.wordsSaved, 0)).toBe(1);
});
test('deleted cards remain protected without any partial translation or counter write', async () => {
  await addSenseTerm('bank', 'банк', 'I use the bank.');
  await db.srsCards.update('word:bank', { deletedAt: Date.now() + 1000 });
  const before = await db.srsCards.get('word:bank'); const stats = await db.activity.toArray();
  expect((await addSenseTerm('bank', 'берег', 'The bank.')).state).toBe('deleted');
  expect(await db.srsCards.get('word:bank')).toEqual(before); expect(await db.activity.toArray()).toEqual(stats);
  expect((await db.translations.get('bank'))?.ru).toBe('банк');
});
test.each(['storage', 'owner'] as const)('creation and dirty/cache writes roll back on %s failure', async reason => {
  const put = db.translations.put.bind(db.translations);
  vi.spyOn(db.translations, 'put').mockImplementation((...args) => {
    if (reason === 'storage') return Dexie.Promise.reject(new Error('No storage'));
    return put(...args).then(key => { invalidateDataScope(); return key; });
  });
  expect((await addSenseTerm('bank', 'берег', 'The bank.')).state).toBe('failed');
  expect(await db.srsCards.count()).toBe(0); expect(await db.translations.count()).toBe(0); expect(await db.pending.count()).toBe(0); expect(await db.activity.count()).toBe(0);
});
