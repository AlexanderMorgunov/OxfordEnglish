import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { passageTextParts, prepareText, translatePassage, type PassageResume } from './text-workbench';
import { translationChunks, utf8Size } from './translation-chunks';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useEntitlement } from '@/features/account/entitlement';
import { useAccount } from '@/features/account/store';
import { aiTranslate } from '@/features/ai/functions';
import { translateText } from './translate';

vi.mock('@/features/ai/functions', () => ({ aiTranslate: vi.fn() }));
vi.mock('./translate', () => ({ translateText: vi.fn() }));
const config = { provider: 'custom' as const, apiKey: 'test-only', model: 'test-only', baseUrl: 'https://test.invalid' };
beforeEach(() => {
  vi.resetAllMocks();
  useAccount.setState({ status: 'anonymous' });
  useEntitlement.setState({ entitlement: null });
});
afterEach(() => vi.useRealTimers());

test('validation retains over-limit input and rejects empty or predominantly Russian input', () => {
  expect(prepareText('   ').issue).toBe('empty');
  expect(prepareText('Русский текст').issue).toBe('not-english');
  expect(prepareText('a'.repeat(2001))).toEqual({ text: 'a'.repeat(2001), issue: 'too-long' });
  expect(prepareText('a'.repeat(2000)).issue).toBeUndefined();
});
test('Unicode chunks fit both service budgets without losing punctuation or cutting surrogate pairs', () => {
  const text = 'Café 😀 is lovely! ' + '😀'.repeat(200) + ' longword'.repeat(100);
  for (const cap of [300, 500]) {
    const chunks = translationChunks(text, cap);
    expect(chunks.every(part => utf8Size(part) <= cap && !part.includes('\uFFFD'))).toBe(true);
    expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  }
});
test.each(['He said "Hello." Next sentence.', 'Read (this.) Next.', 'See [this.] Next.'])('sentence chunking preserves closing punctuation (%s)', text => {
  const chunks = translationChunks(text, 20);
  expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
});
test('free mode is explicit and preserves the full passage contract', async () => {
  vi.mocked(translateText).mockResolvedValue('Первый.\n\nВторой.');
  expect(await translatePassage('First.\n\nSecond.', { mode: 'free', config, signal: new AbortController().signal })).toBe('Первый.\n\nВторой.');
  expect(translateText).toHaveBeenCalledWith('First.\n\nSecond.', expect.objectContaining({ mode: 'passage' }));
  expect(aiTranslate).not.toHaveBeenCalled();
});
test('AI pins the provider across chunks even when entitlement changes and preserves paragraphs', async () => {
  useEntitlement.setState({ entitlement: { plan: 'pro', active: true, ai: { used: 0, limit: 100 } } });
  vi.mocked(aiTranslate).mockImplementation(async () => {
    useEntitlement.setState({ entitlement: null });
    return 'Перевод';
  });
  const result = await translatePassage('long '.repeat(120) + '\n\nSecond.', { mode: 'ai', config, signal: new AbortController().signal });
  expect(result.split('\n\n')).toHaveLength(2);
  expect(aiTranslate).toHaveBeenCalledTimes(3);
  for (const [, text, opts] of vi.mocked(aiTranslate).mock.calls) {
    expect(utf8Size(text)).toBeLessThanOrEqual(300);
    expect(opts).toMatchObject({ path: 'managed', cachePrefix: 'text-workbench:ai ' });
  }
  expect(translateText).not.toHaveBeenCalled();
});
test.each(['cancel', 'owner', 'failure'] as const)('AI stops after %s and never substitutes a free result', async (reason) => {
  const controller = new AbortController();
  vi.mocked(aiTranslate).mockImplementation(async () => {
    if (reason === 'cancel') controller.abort();
    if (reason === 'owner') invalidateDataScope();
    if (reason === 'failure') throw new Error('Unavailable');
    return 'Перевод';
  });
  await expect(translatePassage('word '.repeat(200), { mode: 'ai', config, signal: controller.signal })).rejects.toThrow();
  expect(aiTranslate).toHaveBeenCalledOnce();
  expect(translateText).not.toHaveBeenCalled();
});
test('a fallback keeps remaining segments on BYOK and reports completed progress', async () => {
  useEntitlement.setState({ entitlement: { plan: 'pro', active: true, ai: { used: 0, limit: 100 } } });
  vi.mocked(aiTranslate).mockImplementation(async (_config, _text, opts) => {
    opts?.onSource?.('byok', false);
    return 'Перевод';
  });
  const onProgress = vi.fn();
  await translatePassage('word '.repeat(180), { mode: 'ai', config, signal: new AbortController().signal, onProgress });
  expect(vi.mocked(aiTranslate).mock.calls[0]?.[2]?.path).toBe('managed');
  expect(vi.mocked(aiTranslate).mock.calls.slice(1).every(call => call[2]?.path === 'byok')).toBe(true);
  expect(onProgress).toHaveBeenLastCalledWith(expect.stringContaining('Перевод'), ['byok'], { completed: 3, total: 3 });
});
test('progress counts repeated AI segments by occurrence when resuming', async () => {
  const resume: PassageResume = new Map([['Same.', { text: 'Одинаковый.', path: 'byok' }]]);
  const onProgress = vi.fn();
  expect(await translatePassage('Same.\n\nSame.', { mode: 'ai', config, signal: new AbortController().signal, resume, onProgress })).toBe('Одинаковый.\n\nОдинаковый.');
  expect(onProgress.mock.calls.map(call => call[2])).toEqual([
    { completed: 0, total: 2 }, { completed: 1, total: 2 }, { completed: 2, total: 2 },
  ]);
  expect(aiTranslate).not.toHaveBeenCalled();
});
test('unconfirmed AI provenance stays unknown in progress and resumed segments', async () => {
  const resume: PassageResume = new Map();
  const onProgress = vi.fn();
  vi.mocked(aiTranslate).mockResolvedValue('Перевод');
  const options = { mode: 'ai' as const, config, signal: new AbortController().signal, resume, onProgress };
  await translatePassage('Hello.', options);
  await translatePassage('Hello.', options);
  expect(onProgress).toHaveBeenLastCalledWith('Перевод', [], { completed: 1, total: 1 });
  expect(resume.get('Hello.')?.path).toBeUndefined();
  expect(aiTranslate).toHaveBeenCalledOnce();
});
test('AI does not resume a free translation of the same text', async () => {
  const resume: PassageResume = new Map([['Hello.', { text: 'Бесплатный.', path: 'free' }]]);
  vi.mocked(aiTranslate).mockImplementation(async (_config, _text, opts) => {
    opts?.onSource?.('byok', false);
    return 'AI-перевод.';
  });
  expect(await translatePassage('Hello.', { mode: 'ai', config, signal: new AbortController().signal, resume })).toBe('AI-перевод.');
  expect(aiTranslate).toHaveBeenCalledOnce();
  expect(resume.get('Hello.')).toEqual({ text: 'AI-перевод.', path: 'byok' });
});
test('fragment estimates match normalization and the selected service byte budget', () => {
  const text = 'word '.repeat(180) + '\n\nSame.';
  expect(passageTextParts(text, 'ai')).toBe(4);
  expect(passageTextParts(text, 'free')).toBe(3);
  expect(passageTextParts('   ', 'free')).toBe(0);
});
test('the AI operation deadline aborts its active segment and prevents following calls', async () => {
  vi.useFakeTimers();
  useEntitlement.setState({ entitlement: { plan: 'pro', active: true, ai: { used: 0, limit: 100 } } });
  vi.mocked(aiTranslate).mockImplementation((_config, _text, opts) => new Promise((_resolve, reject) => {
    opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const task = translatePassage('word '.repeat(200), { mode: 'ai', config, signal: new AbortController().signal });
  const rejection = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(180000);
  await rejection;
  expect(aiTranslate).toHaveBeenCalledOnce();
});
