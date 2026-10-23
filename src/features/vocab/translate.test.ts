import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { translateText, translateWord, translateTermProposal } from './translate';

beforeEach(async () => {
  await db.open();
  await db.translations.clear();
});
afterEach(() => vi.unstubAllGlobals());

test('a pending automatic word translation cannot overwrite a manual correction', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      })
  );
  vi.stubGlobal('fetch', fetcher);
  const lookup = translateWord('all');
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
  await db.translations.put({ word: 'all', ru: 'всё', source: 'manual' });
  resolve(
    new Response(JSON.stringify({ responseData: { translatedText: 'все' } }))
  );
  expect(await lookup).toBe('всё');
  expect(await db.translations.get('all')).toMatchObject({
    ru: 'всё',
    source: 'manual',
  });
});

test('a phrase lookup uses the same case-insensitive key as the vocabulary editor', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            responseData: { translatedText: 'ошибочный ответ' },
          })
        )
    )
  );
  await db.translations.put({
    word: 'sneaking suspicion',
    ru: 'смутное подозрение',
    source: 'manual',
  });
  expect(await translateText('Sneaking suspicion')).toBe('смутное подозрение');
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['', 'ручной перевод'])('an explicit proposal bypasses the manual cache %s without modifying it', async (manual) => {
  await db.translations.put({ word: 'bank', ru: manual, source: 'manual' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'берег' } }))));
  expect(await translateTermProposal('bank')).toBe('берег');
  expect(fetch).toHaveBeenCalledOnce();
  expect(await db.translations.get('bank')).toMatchObject({ ru: manual, source: 'manual' });
});

test('an explicit proposal can use an automatic cached answer offline; fresh lookup is separate', async () => {
  await db.translations.put({ word: 'bank', ru: 'банк', source: 'mymemory' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'берег' } }))));
  expect(await translateTermProposal('bank')).toBe('банк');
  expect(fetch).not.toHaveBeenCalled();
  expect(await translateTermProposal('bank', { fresh: true })).toBe('берег');
  expect(await db.translations.get('bank')).toMatchObject({ ru: 'банк', source: 'mymemory' });
});

test('does not display the observed learned fuzzy corpus translation, including a legacy cached abbreviation', async () => {
  await db.translations.put({ word: 'learned', ru: 'и др.', source: 'mymemory' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    responseData: { translatedText: 'и др.', match: 0.99 },
    matches: [
      { segment: 'learned.', translation: 'и др.', match: 0.99, source: 'en-GB', target: 'ru-RU' },
      { segment: 'Learned', translation: 'Не научился', match: 0.98, source: 'en-GB', target: 'ru-RU' },
    ],
  }))));
  expect(await translateWord('learned')).toBeNull();
  expect(fetch).toHaveBeenCalledOnce();
});

test('selects an exact Russian alternative instead of a fuzzy primary term segment', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    responseData: { translatedText: 'возле берега', match: 0.85 },
    matches: [
      { segment: 'river bank', translation: 'берег реки', match: 1, source: 'en', target: 'ru' },
      { segment: 'bank', translation: 'банк', match: 1, source: 'en-GB', target: 'ru-RU' },
    ],
  }))));
  expect(await translateWord('bank')).toBe('банк');
  expect(await db.translations.get('bank')).toMatchObject({ ru: 'банк', source: 'mymemory' });
});

test('preserves exact automatic glosses offline and never rejects a manual abbreviation', async () => {
  await db.translations.bulkPut([
    { word: 'shelter', ru: 'укрытие', source: 'mymemory' },
    { word: 'learned', ru: 'и др.', source: 'manual' },
  ]);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  expect(await translateWord('shelter')).toBe('укрытие');
  expect(await translateWord('learned')).toBe('и др.');
  expect(fetch).not.toHaveBeenCalled();
});

test('passage translation retains sentence matches rather than applying a word-only exactness rule', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'Она выучила новые слова.', match: 0.99 } }))));
  expect(await translateText('She learned new words.', { mode: 'passage' })).toBe('Она выучила новые слова.');
});
