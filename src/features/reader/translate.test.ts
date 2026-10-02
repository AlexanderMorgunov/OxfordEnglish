import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invalidateDataScope } from '@/features/account/dataScope';

const mocks = vi.hoisted(() => ({ ai: vi.fn(), free: vi.fn() }));
vi.mock('@/features/ai/functions', () => ({ aiTranslate: mocks.ai }));
vi.mock('@/features/ai/route', () => ({ aiAvailable: () => true }));
vi.mock('@/features/vocab/translate', () => ({ translateText: mocks.free }));
const { translateReaderResult, translateReaderText } = await import('./translate');

beforeEach(() => { vi.clearAllMocks(); mocks.free.mockResolvedValue('перевод без контекста'); });
afterEach(() => vi.restoreAllMocks());

test('AI phrase translation carries contextual provenance and text-only callers remain compatible', async () => {
  mocks.ai.mockResolvedValue('смутное подозрение');
  const opts = { ai: true, config: null, sentence: 'I had a sneaking suspicion.' };
  expect(await translateReaderResult('sneaking suspicion', opts)).toEqual({ text: 'смутное подозрение', contextual: true });
  expect(await translateReaderText('sneaking suspicion', opts)).toBe('смутное подозрение');
  expect(mocks.free).not.toHaveBeenCalled();
});

test('free fallback is not presented as a contextual meaning', async () => {
  mocks.ai.mockRejectedValue(new Error('offline'));
  expect(await translateReaderResult('sneaking suspicion', { ai: true, config: null, sentence: 'I had a sneaking suspicion.' })).toEqual({ text: 'перевод без контекста', contextual: false });
});

test('an old-owner AI result cannot initiate a free fallback or return private text', async () => {
  let reject!: (error: Error) => void;
  mocks.ai.mockImplementation(() => new Promise<string>((_resolve, fail) => { reject = fail; }));
  const pending = translateReaderResult('sneaking suspicion', { ai: true, config: null, sentence: 'I had a sneaking suspicion.' });
  invalidateDataScope();
  reject(new Error('late response'));
  expect(await pending).toBeNull();
  expect(mocks.free).not.toHaveBeenCalled();
});
