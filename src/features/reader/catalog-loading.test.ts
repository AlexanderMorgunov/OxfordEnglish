import { afterEach, expect, test, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test('a failed catalog load can be retried and does not become a cached empty success', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('{}', { status:503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ books:[] }), { status:200 }));
  vi.stubGlobal('fetch', fetch);
  const {loadCatalog} = await import('./catalog');
  await expect(loadCatalog({strict:true})).rejects.toThrow('catalog-unavailable');
  await expect(loadCatalog({strict:true})).resolves.toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('optional recommendation callers retain their non-blocking empty fallback', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const {loadCatalog} = await import('./catalog');
  await expect(loadCatalog()).resolves.toEqual([]);
});
