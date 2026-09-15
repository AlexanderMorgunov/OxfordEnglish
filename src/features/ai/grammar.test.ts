import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ProviderModule from './provider';

const complete = vi.fn();
vi.mock('./provider', async (importOriginal) => ({
  ...(await importOriginal<typeof ProviderModule>()),
  complete: (...args: unknown[]) => complete(...args),
}));

import { aiGrammar } from './functions';
import { db } from '@/db/db';
import type { AiConfig } from './provider';

const cfg: AiConfig = { provider: 'deepseek', apiKey: 'k', model: 'test-model', baseUrl: 'https://x' };

beforeEach(async () => {
  complete.mockReset();
  await db.translations.clear().catch(() => undefined);
});

describe('aiGrammar', () => {
  it('returns the RU explanation, caches it, and a repeat skips the model', async () => {
    complete.mockResolvedValueOnce('Здесь Past Perfect «had started»: действие произошло раньше другого.');
    const s = 'By the time we arrived, the film had already started.';
    expect(await aiGrammar(cfg, s, { level: 'B1' })).toContain('Past Perfect');
    await aiGrammar(cfg, s, { level: 'B1' }); // cache hit
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-Russian answer (model explained in English)', async () => {
    complete.mockResolvedValueOnce('This sentence uses the past perfect tense.');
    await expect(aiGrammar(cfg, 'X had gone home.', { level: 'A2' })).rejects.toThrow();
  });

  it('caps tokens, disables reasoning, and sends few-shot turns', async () => {
    complete.mockResolvedValueOnce('Объяснение по-русски для ученика.');
    await aiGrammar(cfg, 'She has been working all day.', { level: 'B1' });
    const [, messages, opts] = complete.mock.calls[0] as [
      unknown,
      { role: string }[],
      { maxTokens?: number; noReasoning?: boolean },
    ];
    // The cap still exists to stop the 48k-token runaway; it is 700 rather than 512 because the
    // answer target grew and groq's gpt-oss reasoning shares the same budget.
    expect(opts.maxTokens).toBeGreaterThan(0);
    expect(opts.maxTokens).toBeLessThanOrEqual(1000);
    expect(opts.noReasoning).toBe(true);
    // TWO few-shot pairs: the short one, and a multi-clause one. With only the short example the model
    // answered every sentence in that shape, which is what made long periods look half-explained.
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
  });
});
