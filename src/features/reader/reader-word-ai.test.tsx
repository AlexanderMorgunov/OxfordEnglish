import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import * as api from '@/features/account/api';
import type { Entitlement } from '@/features/account/contract';
import { useAiStore } from '@/features/ai/store';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { ReadingText } from './reading-text';
import { useReaderSettings } from './settings';

const mocks = vi.hoisted(() => ({ free: vi.fn() }));
vi.mock('@/features/vocab/translate', async (original) => ({ ...(await original<object>()), translateWord: mocks.free }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('./difficulty', async (original) => ({ ...(await original<object>()), loadFreq: async () => null }));
vi.mock('@/features/vocab/lemma', async (original) => ({ ...(await original<object>()), useLemma: () => ({ byForm: new Map(), lemmas: new Set() }) }));
vi.mock('@/features/vocab/cefr', async (original) => ({ ...(await original<object>()), useCefr: () => new Map() }));

const sentence = 'This book is a work of fiction.';
const answer = 'художественное произведение';
const plan = (kind: Entitlement['plan'] = 'pro', used = 0): Entitlement => ({
  plan: kind, active: kind !== 'free', ai: { used, limit: 10 },
});
const response = (used = 1) => ({ content: `${answer}\nЕщё: вымысел`, ai: { used, limit: 10 }, cached: false });
const panel = () => screen.getByRole('dialog', { name: 'fiction' });
let user = userEvent.setup({ delay: null });

beforeEach(async () => {
  user = userEvent.setup({ delay: null });
  invalidateDataScope();
  useAccount.setState({ status: 'authenticated', accountId: 'word-ai-fixture', getAccessToken: vi.fn().mockResolvedValue('fixture-only-token') });
  useEntitlement.setState({ entitlement: plan() });
  useAiStore.setState({ config: null });
  useReaderSettings.setState({ coloring: false, aiTranslation: false });
  useVocabStore.setState({ statuses: new Map(), ready: false });
  mocks.free.mockReset().mockResolvedValue('бесплатное значение');
  for (const key of Object.keys(localStorage)) if (key.startsWith('ai:')) localStorage.removeItem(key);
  await db.open();
  await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.translations.clear(), db.pending.clear(), db.activity.clear(), db.reviewLog.clear()]);
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('min-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(api, 'aiComplete').mockResolvedValue(response());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function open(paragraph = sentence) {
  render(<><aside id="word-ai-help" /><ReadingText paragraphs={[paragraph]} helpTargetId="word-ai-help" /></>, { wrapper: MemoryRouter });
  await user.click(screen.getByRole('button', { name: 'fiction' }));
}

test.each(['pro', 'trial'] as const)('%s without BYOK automatically resolves contextual meaning and saves the displayed answer', async (kind) => {
  useEntitlement.setState({ entitlement: plan(kind) });
  await open();
  expect(within(panel()).queryByRole('button', { name: 'Refine meaning' })).toBeNull();
  await waitFor(() => expect(api.aiComplete).toHaveBeenCalledOnce());
  expect(api.aiComplete).toHaveBeenCalledWith('fixture-only-token', { task: 'wordInContext', word: 'fiction', sentence }, expect.any(AbortSignal));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue(answer));
  expect(await db.srsCards.count()).toBe(0);
  await user.click(within(panel()).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('word:fiction')).toMatchObject({ back: answer, contextGloss: answer, contextSentence: sentence }));
  await user.click(within(panel()).getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'fiction' }));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue(answer));
  await waitFor(() => expect(within(panel()).queryByText('Refining meaning…')).toBeNull());
  expect(api.aiComplete).toHaveBeenCalledOnce();
});

test('a failed AI lookup keeps the free meaning and supports an explicit retry', async () => {
  vi.mocked(api.aiComplete).mockRejectedValueOnce(new api.ApiFailure('ai_unavailable', 503));
  await open();
  expect(await within(panel()).findByRole('alert')).toHaveTextContent('unavailable');
  expect(within(panel()).getByText('бесплатное значение')).toBeInTheDocument();
  await user.click(within(panel()).getByRole('button', { name: 'Retry request' }));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue(answer));
  expect(api.aiComplete).toHaveBeenCalledTimes(2);
});

test('a one-word book heading still receives an automatic Pro meaning', async () => {
  await open('fiction');
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue(answer));
  expect(api.aiComplete).toHaveBeenCalledWith('fixture-only-token', { task: 'wordInContext', word: 'fiction', sentence: 'fiction' }, expect.any(AbortSignal));
});

test('the last quota unit can resolve visibly and a cached reopen does not spend again', async () => {
  useEntitlement.setState({ entitlement: plan('pro', 9) });
  vi.mocked(api.aiComplete).mockResolvedValue(response(10));
  await open();
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue(answer));
  expect(useEntitlement.getState().entitlement?.ai.used).toBe(10);
  await user.click(within(panel()).getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'fiction' }));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue(answer));
  await waitFor(() => expect(within(panel()).queryByText('Refining meaning…')).toBeNull());
  expect(api.aiComplete).toHaveBeenCalledOnce();
});

test('unknown entitlement waits for confirmation before automatically requesting AI', async () => {
  useEntitlement.setState({ entitlement: null });
  await open();
  expect(within(panel()).getByRole('button', { name: 'Refine meaning' })).toBeInTheDocument();
  expect(api.aiComplete).not.toHaveBeenCalled();
  act(() => useEntitlement.setState({ entitlement: plan('trial') }));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue(answer));
  expect(api.aiComplete).toHaveBeenCalledOnce();
});

test('a spent quota without cached context falls back without a managed request', async () => {
  useEntitlement.setState({ entitlement: plan('pro', 10) });
  await open();
  await within(panel()).findByRole('alert');
  expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('бесплатное значение');
  expect(api.aiComplete).not.toHaveBeenCalled();
});

test('expired access keeps the free lookup without an automatic AI request', async () => {
  useEntitlement.setState({ entitlement: { ...plan('free'), trialEndsAt: Date.now() - 1000 } });
  await open();
  await within(panel()).findByText('бесплатное значение');
  expect(within(panel()).queryByText('in this sentence · AI')).toBeNull();
  expect(api.aiComplete).not.toHaveBeenCalled();
});

test('quick dismissal cancels the debounce without spending a request', async () => {
  await open();
  await user.click(within(panel()).getByRole('button', { name: 'Close' }));
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(api.aiComplete).not.toHaveBeenCalled();
});

test('cancelling an automatic request prevents a late result and does not restart it', async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  vi.mocked(api.aiComplete).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await open();
  await waitFor(() => expect(api.aiComplete).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.aiComplete).mock.calls[0]?.[2];
  await user.click(within(panel()).getByRole('button', { name: 'Cancel request' }));
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(response()));
  expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('бесплатное значение');
  expect(within(panel()).getByRole('button', { name: 'Refine meaning' })).toBeInTheDocument();
  await new Promise((done) => setTimeout(done, 450));
  expect(api.aiComplete).toHaveBeenCalledOnce();
  await user.click(within(panel()).getByRole('button', { name: 'Refine meaning' }));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue(answer));
  expect(api.aiComplete).toHaveBeenCalledTimes(2);
});

test('expiry while waiting aborts automatic work and retains the free answer', async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  vi.mocked(api.aiComplete).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await open();
  await waitFor(() => expect(api.aiComplete).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.aiComplete).mock.calls[0]?.[2];
  act(() => useEntitlement.setState({ entitlement: plan('free') }));
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(response()));
  expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('бесплатное значение');
  expect(within(panel()).queryByText(`${answer} Ещё: вымысел`)).toBeNull();
  expect(Object.keys(localStorage).filter((key) => key.startsWith('ai:'))).toEqual([]);
});

test('a late automatic meaning preserves a typed draft and its saved value', async () => {
  let resolve!: (value: ReturnType<typeof response>) => void;
  vi.mocked(api.aiComplete).mockImplementation(() => new Promise((done) => { resolve = done; }));
  await open();
  await waitFor(() => expect(api.aiComplete).toHaveBeenCalledOnce());
  await user.clear(within(panel()).getByLabelText('Your meaning to save'));
  await user.type(within(panel()).getByLabelText('Your meaning to save'), 'Мой перевод');
  await user.click(within(panel()).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('word:fiction')).toMatchObject({ back: 'Мой перевод', contextGloss: 'Мой перевод' }));
  await act(async () => resolve(response()));
  await waitFor(() => expect(within(panel()).getByText(`${answer} Ещё: вымысел`)).toBeInTheDocument());
  expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('Мой перевод');
  expect(await db.srsCards.get('word:fiction')).toMatchObject({ back: 'Мой перевод', contextGloss: 'Мой перевод' });
});
