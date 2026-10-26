import 'fake-indexeddb/auto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { track } from './analytics';
import { addWordCard, addPhraseCard } from '@/features/srs/service';
import { useExerciseAttempt } from '@/features/practice/exercises/shared';
import { useSessionResults } from '@/features/progress/sessionResults';
import { usePassageTranslation } from '@/features/vocab/usePassageTranslation';
import { translatePassage } from '@/features/vocab/text-workbench';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAiStore } from '@/features/ai/store';
import { useAccount } from '@/features/account/store';

vi.mock('./analytics', () => ({ track: vi.fn() }));
vi.mock('@/features/vocab/text-workbench', async original => ({ ...await original<object>(), translatePassage: vi.fn() }));
beforeEach(async () => {
  invalidateDataScope(); vi.mocked(track).mockClear(); vi.mocked(translatePassage).mockReset();
  useSessionResults.setState({ results: {} });
  useAccount.setState({ status: 'anonymous', accountId: null }); useAiStore.setState({ config: null });
  await db.open(); await Promise.all([db.srsCards.clear(), db.pending.clear(), db.activity.clear(), db.wordStatus.clear(), db.attempts.clear()]);
});
afterEach(cleanup);

test('counts committed new words and phrases once, including concurrent duplicate saves', async () => {
  await Promise.all([addWordCard('fixture', 'пример'), addWordCard('fixture', 'пример')]);
  await addPhraseCard('take care', 'береги себя'); await addPhraseCard('take care', 'береги себя');
  expect(vi.mocked(track).mock.calls).toEqual([['word_saved'], ['phrase_saved']]);
  const card = await db.srsCards.get('word:fixture');
  expect(card).toBeDefined();
});

test('failed card persistence produces no save conversion', async () => {
  const spy = vi.spyOn(db.srsCards, 'get').mockRejectedValueOnce(new Error('Synthetic database failure'));
  expect(await addWordCard('fixture', 'пример')).toBe(false); expect(track).not.toHaveBeenCalled(); spy.mockRestore();
});

test('first intentional answer counts once and restored exercise state does not count on mount', () => {
  const view = renderHook(() => useExerciseAttempt({ id: 'fixture', tags: [] }));
  expect(track).not.toHaveBeenCalled();
  act(() => view.result.current.submit(false, 'private answer'));
  act(() => view.result.current.submit(true, 'another private answer'));
  view.unmount(); renderHook(() => useExerciseAttempt({ id: 'fixture', tags: [] }));
  expect(vi.mocked(track).mock.calls).toEqual([['practice_answered']]);
});

test.each(['free', 'ai'] as const)('only the completed %s passage records a translation conversion', async mode => {
  if (mode === 'ai') useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture-only', model: 'fixture', baseUrl: 'https://fixture.invalid' } });
  vi.mocked(translatePassage).mockResolvedValue('Перевод');
  const view = renderHook(() => usePassageTranslation());
  await act(async () => { await view.result.current.start('Private source fixture.', mode); });
  expect(vi.mocked(track).mock.calls).toEqual([[`text_translate_${mode}_success`]]);
});

test.each(['cancel', 'owner', 'unmount', 'failure'] as const)('%s does not report a translation success', async reason => {
  let resolve!: (value: string) => void;
  vi.mocked(translatePassage).mockImplementation(async (_text, options) => {
    options.onProgress?.('Часть', [], { completed: 1, total: 2 });
    if (reason === 'failure') throw new Error('Synthetic failure');
    return new Promise<string>(done => { resolve = done; });
  });
  const view = renderHook(() => usePassageTranslation());
  let running!: Promise<void>;
  act(() => { running = view.result.current.start('Private source fixture.', 'free'); });
  if (reason === 'cancel') act(() => view.result.current.cancel());
  if (reason === 'owner') act(() => invalidateDataScope());
  if (reason === 'unmount') view.unmount();
  await act(async () => { if (reason !== 'failure') resolve('Late private result'); await running; });
  expect(track).not.toHaveBeenCalled();
});
