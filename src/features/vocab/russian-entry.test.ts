import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { releasePreviousAccountData } from '@/features/sync/engine';
import { translateRussianTerm, RussianTermSchema, EnglishDraftSchema, RU_ENTRY_PREFIX, RU_ENTRY_TTL } from './russian-entry';

const response = (english = 'lock', extra = {}) => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: english }, ...extra }));
const signal = () => new AbortController().signal;
beforeEach(async () => { await db.open(); await db.translations.clear(); vi.stubGlobal('fetch', vi.fn(async () => response())); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

test('reverse request is explicit ru|en and only uses the primary translation', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response('lock', { matches: [{ segment: 'замок', translation: 'castle' }] }));
  expect(await translateRussianTerm('  замок  ', signal())).toEqual({ russian: 'замок', english: 'lock', cached: false });
  expect(new URL(String(vi.mocked(fetch).mock.calls[0]?.[0])).searchParams.get('langpair')).toBe('ru|en');
  expect(await db.translations.get('замок')).toBeUndefined(); expect(await db.translations.get('lock')).toBeUndefined();
});
test('source and draft normalize without merging case and reject mixed scripts/oversized input', () => {
  expect(RussianTermSchema.parse('  доброе   утро ')).toBe('доброе утро');
  expect(EnglishDraftSchema.parse('  Good   morning ')).toBe('Good morning');
  for (const raw of ['', 'onion', 'лук onion', 'лук\nлук', 'а'.repeat(81), ' '.repeat(161)]) expect(RussianTermSchema.safeParse(raw).success).toBe(false);
  for (const raw of ['лук', 'lock / castle', '<b>onion</b>', 'x'.repeat(81)]) expect(EnglishDraftSchema.safeParse(raw).success).toBe(false);
});
test.each(['', 'лук', 'lock castle; use both', 'MYMEMORY WARNING', '<b>onion</b>', 'x'.repeat(81)])('invalid primary output %s is not cached', async english => {
  vi.mocked(fetch).mockResolvedValueOnce(response(english));
  await expect(translateRussianTerm('лук', signal())).rejects.toThrow(); expect(await db.translations.count()).toBe(0);
});
test('single terminal sentence mark and curly apostrophe are normalized for a phrase', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response('It’s fine.'));
  expect((await translateRussianTerm('всё хорошо', signal())).english).toBe("It's fine");
});
test.each(['quota', 'status', 'http', 'json', 'large'] as const)('rejects provider %s failure without caching', async reason => {
  const value = reason === 'quota' ? response('lock', { quotaFinished: true }) : reason === 'status' ? response('lock', { responseStatus: 403 }) : reason === 'http' ? new Response('failure', { status: 503 }) : reason === 'json' ? new Response('not JSON') : new Response(' '.repeat(32769));
  vi.mocked(fetch).mockResolvedValueOnce(value);
  await expect(translateRussianTerm('замок', signal())).rejects.toThrow(); expect(await db.translations.count()).toBe(0);
});
test('valid source cache is free offline, with no ordinary cache changes', async () => {
  await db.translations.put({ word: 'lock', ru: 'старый замок', source: 'manual' });
  await translateRussianTerm('замок', signal());
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Offline'));
  expect(await translateRussianTerm('замок', signal())).toEqual({ russian: 'замок', english: 'lock', cached: true });
  expect(fetch).toHaveBeenCalledOnce(); expect((await db.translations.get('lock'))?.ru).toBe('старый замок');
});
test.each(['expired', 'future', 'version', 'invalid', 'source'] as const)('invalid %s cache requests a fresh result', async reason => {
  await db.translations.put({ word: `${RU_ENTRY_PREFIX}замок`, source: reason === 'source' ? 'manual' : 'lens-ru-en', ru: JSON.stringify({ version: reason === 'version' ? 'v0' : 'v1', at: Date.now() + (reason === 'future' ? 1000 : reason === 'expired' ? -RU_ENTRY_TTL : 0), english: reason === 'invalid' ? 'замок' : 'castle' }) });
  expect((await translateRussianTerm('замок', signal())).english).toBe('lock'); expect(fetch).toHaveBeenCalledOnce();
  if (reason === 'source') expect((await db.translations.get(`${RU_ENTRY_PREFIX}замок`))?.source).toBe('manual');
});
test.each(['abort', 'owner'] as const)('late provider reply after %s never caches', async action => {
  const controller = new AbortController();
  vi.mocked(fetch).mockImplementationOnce(async () => { if (action === 'abort') controller.abort(); else invalidateDataScope(); return response(); });
  await expect(translateRussianTerm('замок', controller.signal)).rejects.toThrow(); expect(await db.translations.count()).toBe(0);
});
test.each(['abort', 'owner'] as const)('cache write rolls back after %s', async action => {
  const controller = new AbortController(); const put = db.translations.put.bind(db.translations);
  vi.spyOn(db.translations, 'put').mockImplementation((...args) => put(...args).then(key => { if (action === 'abort') controller.abort(); else invalidateDataScope(); return key; }));
  await expect(translateRussianTerm('замок', controller.signal)).rejects.toThrow(); expect(await db.translations.count()).toBe(0);
});
test('abort during cache lookup never becomes a network request', async () => {
  const controller = new AbortController();
  vi.spyOn(db.translations, 'get').mockImplementation(() => { controller.abort(); return Dexie.Promise.resolve(undefined); });
  await expect(translateRussianTerm('замок', controller.signal)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
test('cache storage failures still return validated proposals', async () => {
  vi.spyOn(db.translations, 'get').mockRejectedValueOnce(new Error('Read')); vi.spyOn(db.translations, 'put').mockRejectedValueOnce(new Error('Write'));
  expect((await translateRussianTerm('замок', signal())).english).toBe('lock'); expect(await db.translations.count()).toBe(0);
});
test('handover clears reverse cache and leaves ordinary manual terms', async () => {
  await translateRussianTerm('замок', signal()); await db.translations.put({ word: 'lock', ru: 'замок', source: 'manual' });
  await releasePreviousAccountData(); expect(await db.translations.toArray()).toEqual([{ word: 'lock', ru: 'замок', source: 'manual' }]);
});
test('maintenance caps only owned reverse entries and preserves manual collisions', async () => {
  await db.translations.bulkPut(Array.from({ length: 100 }, (_, i) => ({ word: `${RU_ENTRY_PREFIX}fixture${i}`, source: 'lens-ru-en', ru: JSON.stringify({ version: 'v1', at: Date.now() - 1000 - i, english: 'lock' }) })));
  await db.translations.put({ word: `${RU_ENTRY_PREFIX}manual`, source: 'manual', ru: 'ручной' });
  await translateRussianTerm('замок', signal());
  expect(await db.translations.filter(r=>r.source==='lens-ru-en').count()).toBe(100);
  expect((await db.translations.get(`${RU_ENTRY_PREFIX}manual`))?.ru).toBe('ручной');
});
test('one deadline covers a provider that ignores abort and never finishes its body', async () => {
  vi.spyOn(db.translations, 'get').mockResolvedValue(undefined); vi.useFakeTimers();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start() {} })));
  const task = translateRussianTerm('замок', signal()); const rejection = expect(task).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(8000); await rejection; vi.useRealTimers(); expect(await db.translations.count()).toBe(0);
});

test('byte cap cancels a chunked UTF-8 body before buffering the whole response', async () => {
  const cancelled = vi.fn();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode('я'.repeat(17000))); }, cancel: cancelled,
  })));
  await expect(translateRussianTerm('замок', signal())).rejects.toThrow();
  expect(cancelled).toHaveBeenCalledOnce(); expect(await db.translations.count()).toBe(0);
});

test.each(['decode', 'http'] as const)('rejected %s stream releases underlying body', async reason => {
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array([255])); }, cancel: cancelled });
  vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { status: reason === 'http' ? 503 : 200 }));
  await expect(translateRussianTerm('замок', signal())).rejects.toThrow(); expect(cancelled).toHaveBeenCalledOnce();
});
test('provider warning details reject an otherwise valid English primary, harmless metadata allowed', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response('lock', { responseDetails: 'MYMEMORY WARNING: synthetic limit' }));
  await expect(translateRussianTerm('замок', signal())).rejects.toThrow(); expect(await db.translations.count()).toBe(0);
  vi.mocked(fetch).mockResolvedValueOnce(response('lock', { responseDetails: 'Translation completed' }));
  expect((await translateRussianTerm('замок', signal())).english).toBe('lock');
});
test('deadline starts before a hung nonabortable cache read', async () => {
  vi.spyOn(db.translations, 'get').mockImplementation(() => Dexie.Promise.resolve(new Promise<undefined>(() => {})));
  vi.useFakeTimers(); const task = translateRussianTerm('замок', signal()); const rejection = expect(task).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(8000); await rejection; expect(fetch).not.toHaveBeenCalled();
});
