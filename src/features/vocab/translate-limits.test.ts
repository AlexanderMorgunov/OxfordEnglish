import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { translateText } from './translate';

beforeEach(async () => { await db.open(); await db.translations.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

test.each(['long '.repeat(400), 'café '.repeat(130), 'x'.repeat(2400)])('every request fits the UTF-8 cap without dropping long input (%#)', async (text) => {
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(new URL(url).searchParams.get('q')!);
    return new Response(JSON.stringify({ responseData: { translatedText: 'перевод' } }));
  }));
  expect(await translateText(text)).toBeTruthy();
  expect(requests.length).toBeGreaterThan(1);
  expect(requests.every((q) => new TextEncoder().encode(q).length <= 500)).toBe(true);
  expect(requests.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
});

test('full passages preserve paragraphs and have a case-sensitive cache separate from manual terms', async () => {
  await db.translations.put({ word: 'us', ru: 'нам', source: 'manual' });
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'Перевод' } })));
  vi.stubGlobal('fetch', fetcher);
  expect(await translateText('US\n\nSecond.', { mode: 'passage' })).toBe('Перевод\n\nПеревод');
  expect(await translateText('US\n\nSecond.', { mode: 'passage' })).toBe('Перевод\n\nПеревод');
  expect(fetcher).toHaveBeenCalledTimes(2);
  await translateText('us\n\nSecond.', { mode: 'passage' });
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(await translateText('US')).toBe('нам');
});
test('a partial passage failure does not cache an incomplete translation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ responseData: { translatedText: 'Первый' } }))).mockResolvedValueOnce(new Response('', { status: 503 })));
  expect(await translateText('First.\n\nSecond.', { mode: 'passage' })).toBeNull();
  expect(await db.translations.count()).toBe(0);
});
test('cancellation inside the cache write rolls back the transaction', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'Перевод' } }))));
  const put = db.translations.put.bind(db.translations);
  vi.spyOn(db.translations, 'put').mockImplementation((...args) => put(...args).then(key => {
    controller.abort();
    return key;
  }));
  expect(await translateText('First.', { mode: 'passage', signal: controller.signal })).toBeNull();
  expect(await db.translations.count()).toBe(0);
});
test('one deadline covers the whole multi-paragraph translation', async () => {
  vi.spyOn(db.translations, 'get').mockResolvedValue(undefined);
  vi.useFakeTimers();
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    calls += 1;
    setTimeout(() => resolve(new Response(JSON.stringify({ responseData: { translatedText: 'Перевод' } }))), 5000);
    options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  })));
  const task = translateText('First.\n\nSecond.', { mode: 'passage' });
  await vi.waitFor(() => expect(calls).toBe(1));
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls).toBe(2);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await task).toBeNull();
  vi.useRealTimers();
  expect(await db.translations.count()).toBe(0);
});
