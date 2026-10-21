import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { translatePassage, type PassageResume } from './text-workbench';
import { aiTranslate } from '@/features/ai/functions';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { invalidateDataScope } from '@/features/account/dataScope';
import { releasePreviousAccountData } from '@/features/sync/engine';
const config = { provider: 'custom' as const, apiKey: 'test-only', model: 'test-only', baseUrl: 'https://a.invalid' };
beforeEach(async () => {
  useAccount.setState({ status: 'anonymous' });
  useEntitlement.setState({ entitlement: null });
  await db.open(); await db.translations.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test('two BYOK endpoints with the same model translate separately; each can reuse its own cached result', async () => {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: url.includes('a.invalid') ? 'Первый' : 'Второй' } }] })));
  vi.stubGlobal('fetch', fetcher);
  const options = { mode: 'ai' as const, config, signal: new AbortController().signal };
  expect(await translatePassage('Hello', options)).toBe('Первый');
  expect(await translatePassage('Hello', { ...options, config: { ...config, baseUrl: 'https://b.invalid' } })).toBe('Второй');
  expect(await translatePassage('Hello', options)).toBe('Первый');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const keys = await db.translations.toCollection().primaryKeys();
  expect(keys).toHaveLength(2);
  expect(keys.every(key => /\s/.test(key))).toBe(true);
});
test.each(['abort', 'owner'] as const)('AI cache transaction rolls back when %s changes during its write', async action => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Перевод' } }] }))));
  const put = db.translations.put.bind(db.translations);
  vi.spyOn(db.translations, 'put').mockImplementation((...args) => put(...args).then(key => {
    if (action === 'abort') controller.abort(); else invalidateDataScope();
    return key;
  }));
  await expect(aiTranslate(config, 'Hello', { signal: controller.signal, path: 'byok', cachePrefix: 'text-workbench:ai ' })).rejects.toThrow();
  expect(await db.translations.count()).toBe(0);
});
test('handover removes even single-word workbench text caches while preserving ordinary dictionary words', async () => {
  await db.translations.bulkPut([
    { word: 'hello', ru: 'привет', source: 'manual' },
    { word: 'text-workbench:free: Hello', ru: 'Привет', source: 'mymemory' },
    { word: 'text-workbench:ai :managed:Hello', ru: 'Привет', source: 'ai' },
  ]);
  await releasePreviousAccountData();
  expect(await db.translations.toArray()).toEqual([{ word: 'hello', ru: 'привет', source: 'manual' }]);
});

test('free passage exposes completed fragments and resumes only the missing work', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ responseData: { translatedText: 'Первый.' } })))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ responseData: { translatedText: 'Второй.' } })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ responseData: { translatedText: 'Третий.' } })));
  vi.stubGlobal('fetch', fetcher);
  const resume: PassageResume = new Map();
  const onProgress = vi.fn();
  const options = { mode: 'free' as const, config, signal: new AbortController().signal, resume, onProgress };
  const text = 'First.\n\nSecond.\n\nThird.';
  await expect(translatePassage(text, options)).rejects.toThrow('Translation unavailable');
  expect(onProgress).toHaveBeenLastCalledWith('Первый.', [], { completed: 1, total: 3 });
  expect(resume.get('First.')).toEqual({ text: 'Первый.', path: 'free' });
  expect(await db.translations.count()).toBe(0);
  expect(await translatePassage(text, options)).toBe('Первый.\n\nВторой.\n\nТретий.');
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.map(([url]) => new URL(url as string).searchParams.get('q'))).toEqual(['First.', 'Second.', 'Second.', 'Third.']);
  expect(onProgress).toHaveBeenLastCalledWith('Первый.\n\nВторой.\n\nТретий.', [], { completed: 3, total: 3 });
});

test('a whole free cache hit reports all real fragments without new requests', async () => {
  await db.translations.put({ word: 'text-workbench:free: First.\n\nSecond.', ru: 'Первый.\n\nВторой.', source: 'mymemory' });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const onProgress = vi.fn();
  expect(await translatePassage('First.\n\nSecond.', { mode: 'free', config, signal: new AbortController().signal, onProgress })).toBe('Первый.\n\nВторой.');
  expect(onProgress.mock.calls.map(call => call[2])).toEqual([{ completed: 0, total: 2 }, { completed: 2, total: 2 }]);
  expect(fetcher).not.toHaveBeenCalled();
});

test('repeated free fragments count as separate occurrences while reusing completed work', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'Одинаковый.' } })));
  vi.stubGlobal('fetch', fetcher);
  const onProgress = vi.fn();
  expect(await translatePassage('Same.\n\nSame.', { mode: 'free', config, signal: new AbortController().signal, resume: new Map(), onProgress })).toBe('Одинаковый.\n\nОдинаковый.');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(onProgress).toHaveBeenLastCalledWith('Одинаковый.\n\nОдинаковый.', [], { completed: 2, total: 2 });
});

test.each(['abort', 'owner'] as const)('late free completion cannot publish or resume after %s changes', async action => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (action === 'abort') controller.abort(); else invalidateDataScope();
    return new Response(JSON.stringify({ responseData: { translatedText: 'Перевод.' } }));
  }));
  const resume: PassageResume = new Map();
  const onProgress = vi.fn();
  await expect(translatePassage('Hello.', { mode: 'free', config, signal: controller.signal, resume, onProgress })).rejects.toThrow();
  expect(resume.size).toBe(0);
  expect(onProgress).toHaveBeenCalledOnce();
  expect(onProgress).toHaveBeenCalledWith('', [], { completed: 0, total: 1 });
  expect(await db.translations.count()).toBe(0);
});

test('free mode ignores completed AI work for the same segment', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'Бесплатный перевод.' } })));
  vi.stubGlobal('fetch', fetcher);
  const resume: PassageResume = new Map([['Hello.', { text: 'AI-перевод.', path: 'managed' }]]);
  expect(await translatePassage('Hello.', { mode: 'free', config, signal: new AbortController().signal, resume })).toBe('Бесплатный перевод.');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(resume.get('Hello.')).toEqual({ text: 'Бесплатный перевод.', path: 'free' });
});

test.each(['abort', 'owner'] as const)('free whole-passage cache transaction rolls back after %s changes during the write', async action => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'Перевод.' } }))));
  const put = db.translations.put.bind(db.translations);
  vi.spyOn(db.translations, 'put').mockImplementation((...args) => put(...args).then(key => {
    if (action === 'abort') controller.abort(); else invalidateDataScope();
    return key;
  }));
  await expect(translatePassage('Hello.', { mode: 'free', config, signal: controller.signal })).rejects.toThrow();
  expect(await db.translations.count()).toBe(0);
});
