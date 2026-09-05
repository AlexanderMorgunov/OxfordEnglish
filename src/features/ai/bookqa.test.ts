import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ProviderModule from './provider';

const complete = vi.fn();
vi.mock('./provider', async (importOriginal) => ({
  ...(await importOriginal<typeof ProviderModule>()),
  complete: (...args: unknown[]) => complete(...args),
}));

import { aiBookQuestion } from './functions';
import type { AiConfig } from './provider';

const cfg: AiConfig = { provider: 'deepseek', apiKey: 'k', model: 'test-model', baseUrl: 'https://x' };
const PAGE =
  'Alice was tired of sitting by her sister. Suddenly a White Rabbit ran close by her. She followed it down the hole.';

beforeEach(() => complete.mockReset());

describe('aiBookQuestion', () => {
  it('returns the answer and a quote validated as a real substring of the page', async () => {
    complete.mockResolvedValueOnce('Алиса пошла за Белым Кроликом.\nЦИТАТА: Suddenly a White Rabbit ran close by her.');
    const r = await aiBookQuestion(cfg, { pageText: PAGE, question: 'За кем пошла Алиса?' });
    expect(r.answer).toBe('Алиса пошла за Белым Кроликом.');
    expect(r.quote).toBe('Suddenly a White Rabbit ran close by her.');
  });

  it('drops a fabricated quote that is not in the page', async () => {
    complete.mockResolvedValueOnce('Ответ.\nЦИТАТА: This line is not in the book at all.');
    const r = await aiBookQuestion(cfg, { pageText: PAGE, question: 'x' });
    expect(r.answer).toBe('Ответ.');
    expect(r.quote).toBeUndefined();
  });

  it('stuffs the page as the system prefix and the question as user; reasoning off + capped', async () => {
    complete.mockResolvedValueOnce('В этом фрагменте об этом не сказано.');
    await aiBookQuestion(cfg, { pageText: PAGE, question: 'Какого цвета небо?' });
    const [, messages, opts] = complete.mock.calls[0] as [
      unknown,
      { role: string; content: string }[],
      { maxTokens?: number; noReasoning?: boolean },
    ];
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain(PAGE); // page text is the constant prefix (for prompt-cache)
    expect(messages[1]).toEqual({ role: 'user', content: 'Какого цвета небо?' });
    expect(opts.noReasoning).toBe(true);
    expect(opts.maxTokens).toBeGreaterThan(0);
  });
});
