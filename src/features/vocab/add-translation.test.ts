import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { addTerm, editCardAnswer, setTranslation, translateAddedTerm } from './manage';
import { repairCardBack } from '@/features/srs/service';
import { captureDataScope, invalidateDataScope } from '@/features/account/dataScope';
import { translateText, translateWord } from './translate';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.srsCards.clear(), db.translations.clear(), db.wordStatus.clear(), db.pending.clear(), db.activity.clear()]);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function saved() {
  const card = await addTerm('reliable', '', 'These sources are reliable.');
  if (!card) throw new Error('Missing saved fixture');
  return card;
}

function pendingFetch() {
  let resolve!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
  return () => resolve(new Response(JSON.stringify({ responseData: { translatedText: 'надёжный' } })));
}

test('an existing contextual answer avoids an unnecessary general lookup', async () => {
  const card = await saved();
  await db.srsCards.update(card.id, { contextGloss: 'Этим источникам можно доверять.' });
  const existing = await saved();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  expect(await translateAddedTerm(existing)).toBe('done');
  expect(fetch).not.toHaveBeenCalled();
});

test('a manual clear after lookup but before repair remains authoritative', async () => {
  const card = await saved();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'надёжный' } }))));
  const text = await translateWord(card.front);
  expect(text).toBe('надёжный');
  await setTranslation({ key: 'reliable', display: 'reliable', kind: 'word', hasCard: true, cardId: card.id, sortAt: 0 }, '');
  expect(await repairCardBack(card.id, text ?? '', captureDataScope(), card)).toBe(false);
  expect((await db.srsCards.get(card.id))?.back).toBe('reliable');
  expect(await db.translations.get('reliable')).toMatchObject({ source: 'manual', ru: '' });
});

test('a pending automatic reply preserves a manual answer and schedule', async () => {
  const card = await saved();
  const resolve = pendingFetch();
  const job = translateAddedTerm(card);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await editCardAnswer(card, 'моё значение', '');
  const expected = await db.srsCards.get(card.id);
  resolve();
  expect(await job).toBe('superseded');
  expect(await db.srsCards.get(card.id)).toEqual(expected);
});

test('same-id recreation at the same timestamp rejects the original completion', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(12345);
  const original = await saved();
  const resolve = pendingFetch();
  const job = translateAddedTerm(original);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await db.srsCards.delete(original.id);
  const replacement = await saved();
  expect(replacement.createdAt).toBe(original.createdAt);
  expect(replacement.creationId).not.toBe(original.creationId);
  resolve();
  expect(await job).toBe('superseded');
  expect(await db.srsCards.get(original.id)).toEqual(replacement);
});

test('an ownership reset prevents the old lookup from changing the new owner card or cache', async () => {
  const card = await saved();
  const resolve = pendingFetch();
  const job = translateAddedTerm(card);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  invalidateDataScope();
  await db.srsCards.clear();
  const replacement = await saved();
  resolve();
  expect(await job).toBe('superseded');
  expect(await db.srsCards.get(card.id)).toEqual(replacement);
  expect(await db.translations.get('reliable')).toBeUndefined();
});

test('one deadline bounds all chunks instead of allowing eight seconds per chunk', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(new Response(JSON.stringify({ responseData: { translatedText: 'перевод' } }))), 5000);
    options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  })));
  const job = translateText(`${'First '.repeat(70)}. ${'Second '.repeat(60)}.`);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(8000);
  expect(await job).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await db.translations.count()).toBe(0);
});
