import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadPublicPack, PUBLIC_PACK_BASE } from './loader';

const title = { en: 'Test course', ru: 'Тестовый курс' };
const license = { type: 'original', attribution: 'Project authors' };
const manifest = { id: 'test', name: title, version: '1', level: 'A1', visibility: 'public', license };
const dayIds = Array.from({ length: 18 }, (_, i) => `unit.d${i + 1}`);
const course = {
  id: 'test', title, level: 'A1', license,
  units: [{ id: 'unit', title, dayIds }],
};
const day = (id: string) => ({
  id, title, estimatedMinutes: 5, tags: [],
  sections: [{ type: 'vocabulary', id: `${id}.words`, title, words: [{ word: 'hello', ru: 'привет' }] }],
});

function response(path: string): Response {
  const body = path.endsWith('/manifest.json') ? manifest
    : path.endsWith('/course.json') ? course
    : path.endsWith('/grammar.json') ? []
    : day(path.split('/').at(-1)!.replace('.json', ''));
  return new Response(JSON.stringify(body));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a transient 502 is retried without dropping the course or its order', async () => {
  const target = `${PUBLIC_PACK_BASE}/days/${dayIds[0]}.json`;
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === target && ++attempts === 1) return new Response('', { status: 502 });
    return response(path);
  }));

  const result = loadPublicPack();
  void result.catch(() => undefined);
  await vi.runAllTimersAsync();
  const pack = await result;
  expect(attempts).toBe(2);
  expect([...pack.days.keys()]).toEqual(dayIds);
  expect(pack.units[0]!.days.map((d) => d.id)).toEqual(dayIds);
});

test('a fresh course uses bounded concurrency even while response bodies are pending', async () => {
  let active = 0;
  let peak = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (!path.includes('/days/')) return response(path);
    active += 1;
    peak = Math.max(peak, active);
    const res = response(path);
    res.json = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return day(path.split('/').at(-1)!.replace('.json', ''));
    };
    return res;
  }));

  const result = loadPublicPack();
  await vi.runAllTimersAsync();
  expect((await result).days.size).toBe(dayIds.length);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(6);
});

test('a persistent outage has bounded retries and never returns a partial pack', async () => {
  const fetchMock = vi.fn(async (path: string) => response(path));
  fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  const rejected = expect(loadPublicPack()).rejects.toThrow('503');
  await vi.runAllTimersAsync();
  await rejected;
  const counts = new Map<string, number>();
  for (const [path] of fetchMock.mock.calls) counts.set(path, (counts.get(path) ?? 0) + 1);
  expect(Math.max(...counts.values())).toBe(3);
  expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(6);
  expect(vi.getTimerCount()).toBe(0);
});

test('a hard failure stops queued days and aborts requests still in flight', async () => {
  const started: string[] = [];
  let aborted = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    if (!path.includes('/days/')) return response(path);
    started.push(path);
    if (path.endsWith(`/${dayIds[0]}.json`)) return new Response('', { status: 404 });
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        aborted += 1;
        reject(init.signal?.reason);
      }, { once: true });
    });
  }));

  await expect(loadPublicPack()).rejects.toThrow('404');
  expect(started.length).toBeLessThanOrEqual(6);
  expect(aborted).toBe(started.length - 1);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(['invalid-json', 'invalid-schema'])('%s is not retried', async (failure) => {
  const target = `${PUBLIC_PACK_BASE}/days/${dayIds[0]}.json`;
  const fetchMock = vi.fn(async (path: string) => path !== target ? response(path)
    : new Response(failure === 'invalid-json' ? '{' : '{}'));
  vi.stubGlobal('fetch', fetchMock);
  await expect(loadPublicPack()).rejects.toThrow();
  expect(fetchMock.mock.calls.filter(([path]) => path === target)).toHaveLength(1);
});

test('network failures and a hung response body recover within bounded time', async () => {
  let attempts = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (!path.endsWith('/manifest.json')) return response(path);
    attempts += 1;
    if (attempts === 1) throw new TypeError('Failed to fetch');
    const res = response(path);
    if (attempts === 2) res.json = () => new Promise(() => undefined);
    return res;
  }));
  const result = loadPublicPack();
  void result.catch(() => undefined);
  await vi.runAllTimersAsync();
  expect((await result).days.size).toBe(dayIds.length);
  expect(attempts).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});

test('an optional grammar failure does not take down a valid course', async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/grammar.json')
    ? new Response('', { status: 404 }) : response(path)));
  const pack = await loadPublicPack();
  expect(pack.days.size).toBe(dayIds.length);
  expect(pack.grammar).toEqual([]);
});
