import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ProviderModule from './provider';

const complete = vi.fn();
vi.mock('./provider', async (importOriginal) => ({
  ...(await importOriginal<typeof ProviderModule>()),
  complete: (...args: unknown[]) => complete(...args),
}));

import { aiSimplify } from './functions';
import { db } from '@/db/db';
import type { AiConfig } from './provider';

const cfg: AiConfig = { provider: 'deepseek', apiKey: 'k', model: 'test-model', baseUrl: 'https://x' };

beforeEach(async () => {
  complete.mockReset();
  await db.translations.clear().catch(() => undefined);
});

describe('aiSimplify', () => {
  it('returns the rewrite, strips a lead-in, and caches (a repeat skips the model)', async () => {
    complete.mockResolvedValueOnce('Here is the simpler version: The man went home.');
    const src = 'Having wandered the harbour, the man trudged home.';
    expect(await aiSimplify(cfg, src, { level: 'B1' })).toBe('The man went home.');
    expect(await aiSimplify(cfg, src, { level: 'B1' })).toBe('The man went home.'); // cache hit
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rejects a Russian output (model translated instead of simplifying)', async () => {
    complete.mockResolvedValueOnce('Человек пошёл домой.');
    await expect(aiSimplify(cfg, 'The man went home slowly.', { level: 'A2' })).rejects.toThrow();
  });

  it('rejects empty / whitespace output', async () => {
    complete.mockResolvedValueOnce('   ');
    await expect(aiSimplify(cfg, 'A sentence to simplify.', { level: 'A2' })).rejects.toThrow();
  });

  it('passes an echo through unchanged (caller decides how to render it)', async () => {
    complete.mockResolvedValueOnce('The sun went down.');
    expect(await aiSimplify(cfg, 'The sun went down.', { level: 'A2' })).toBe('The sun went down.');
  });

  it('caps output with max_tokens and sends the example as few-shot turns (the runaway-cost fix)', async () => {
    complete.mockResolvedValueOnce('A simpler sentence.');
    await aiSimplify(cfg, 'A dense literary sentence to rewrite here.', { level: 'B1' });
    const [, messages, opts] = complete.mock.calls[0] as [
      unknown,
      { role: string }[],
      { maxTokens?: number; noReasoning?: boolean },
    ];
    expect(opts.maxTokens).toBeGreaterThan(0);
    expect(opts.maxTokens).toBeLessThanOrEqual(512);
    expect(opts.noReasoning).toBe(true); // reasoning off — else deepseek-v4-flash burns the budget thinking
    // system + user(example) + assistant(example) + user(sentence)
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('segments the cache by band, so a step-down calls the model again', async () => {
    complete.mockResolvedValueOnce('At B1 level rewrite.').mockResolvedValueOnce('Even simpler rewrite.');
    const src = 'A dense literary sentence of some length here.';
    await aiSimplify(cfg, src, { level: 'B1', stepDown: 0 });
    await aiSimplify(cfg, src, { level: 'B1', stepDown: 1 });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
