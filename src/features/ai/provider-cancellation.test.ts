import { afterEach, expect, test, vi } from 'vitest';
import { complete } from './provider';
const config = { provider: 'custom' as const, apiKey: 'test-only', model: 'test-only', baseUrl: 'https://test.invalid' };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
test('a truncated BYOK completion is rejected rather than presented as a complete translation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'Незаконченный' } }] }))));
  await expect(complete(config, [])).rejects.toThrow('truncated');
});
test('cancelling during backoff settles immediately without another provider call', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => new Response('', { status: 429 }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const task = complete(config, [], { signal: controller.signal });
  const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(20000);
  expect(fetcher).toHaveBeenCalledOnce();
});
