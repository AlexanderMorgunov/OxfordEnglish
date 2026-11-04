import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { installDialogMock } from '@/test/dialog';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { useProActivation } from '@/features/account/proActivation';
import { ProActivationDialog } from '@/features/account/ProActivationDialog';
import * as api from '@/features/account/api';
import { useAiStore } from '@/features/ai/store';
import { useReaderSettings } from './settings';
import { BookView } from './BookView';
import { currentWordReturn } from './word-return';

const mocks = vi.hoisted(() => ({ free: vi.fn() }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true, API_BASE: 'http://fixture-only.invalid' }));
vi.mock('@/features/vocab/translate', async (original) => ({ ...(await original<object>()), translateWord: mocks.free }));
vi.mock('./ChapterStudy', () => ({ ChapterStudy: () => null }));
vi.mock('./ChapterVocabulary', () => ({ ChapterVocabulary: () => null }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('./difficulty', async (original) => ({ ...(await original<object>()), loadFreq: async () => null }));
vi.mock('@/features/vocab/lemma', async (original) => ({ ...(await original<object>()), useLemma: () => ({ byForm: new Map(), lemmas: new Set() }) }));
vi.mock('@/features/vocab/cefr', async (original) => ({ ...(await original<object>()), useCefr: () => new Map() }));
const free = { plan: 'free' as const, active: false, ai: { used: 0, limit: 0 } };
const trial = { plan: 'trial' as const, active: true, trialEndsAt: Date.now() + 86_400_000, ai: { used: 0, limit: 10 } };
const book = { title: 'A little garden', chapters: [{ id: 'garden', title: 'Garden', text: 'She picked up the hoe.' }] };
const panel = () => screen.getByRole('dialog', { name: 'hoe' });
let user = userEvent.setup({ delay: null });
beforeEach(async () => {
  vi.restoreAllMocks(); installDialogMock(); invalidateDataScope(); localStorage.clear();
  useProActivation.setState({ entry: null });
  useAccount.setState({ status: 'authenticated', accountId: 'reader-fixture', busy: false, getAccessToken: vi.fn().mockResolvedValue('fixture-token') });
  useEntitlement.setState({ entitlement: free, loading: false, error: null });
  useAiStore.setState({ config: null }); useReaderSettings.setState({ coloring: false });
  mocks.free.mockReset().mockResolvedValue(null);
  vi.spyOn(api, 'billingPlans').mockResolvedValue({ available: true, plans: [{ code: 'pro_month', title: 'Pro', days: 30, priceKopecks: 19900 }] });
  vi.spyOn(api, 'getEntitlement').mockResolvedValue(free);
  vi.spyOn(api, 'claimTrial').mockResolvedValue(trial);
  vi.spyOn(api, 'aiComplete').mockResolvedValue({ content: 'мотыга\nЕщё: садовый инструмент', ai: { used: 1, limit: 10 }, cached: false });
  await db.open(); await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.bookmarks.clear()]);
  user = userEvent.setup({ delay: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<MemoryRouter initialEntries={['/library/garden']}><BookView book={book} idPrefix="garden" /><ProActivationDialog /></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: 'hoe' }));
  await waitFor(() => expect(mocks.free).toHaveBeenCalled());
}
test('dictionary miss offers explicit trial, server price and free saving; a known translation does not', async () => {
  await open();
  expect(await within(panel()).findByRole('button', { name: 'Or get Pro · 199 ₽ / 30 days' })).toBeInTheDocument();
  expect(api.claimTrial).not.toHaveBeenCalled(); expect(api.aiComplete).not.toHaveBeenCalled();
  await user.type(within(panel()).getByLabelText('Your meaning to save'), 'мой перевод');
  await user.click(within(panel()).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('word:hoe')).toMatchObject({ back: 'мой перевод' }));
  await user.click(within(panel()).getByRole('button', { name: 'Close' }));
  mocks.free.mockResolvedValue('сад');
  await user.click(screen.getByRole('button', { name: 'picked' }));
  const known = screen.getByRole('dialog', { name: 'picked' });
  await within(known).findByText('сад');
  expect(within(known).queryByRole('button', { name: 'Try 14 days free' })).toBeNull();
});
test('confirmed trial resumes the exact word, keeps a manual draft and requires explicit apply and save', async () => {
  await open();
  await user.type(within(panel()).getByLabelText('Your meaning to save'), 'моё');
  await user.click(within(panel()).getByRole('button', { name: 'Try 14 days free' }));
  await user.click(screen.getByRole('button', { name: 'Start 14 days and translate' }));
  await waitFor(() => expect(api.aiComplete).toHaveBeenCalledOnce());
  expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('моё');
  await user.click(await within(panel()).findByRole('button', { name: 'Apply translation' }));
  expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('мотыга');
  expect(await db.srsCards.count()).toBe(0);
  await user.click(within(panel()).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('word:hoe')).toMatchObject({ back: 'мотыга' }));
  expect(api.claimTrial).toHaveBeenCalledOnce();
});
test('anonymous adoption remounts the book but cancellation returns to the original word and draft', async () => {
  useAccount.setState({ status: 'anonymous', accountId: null });
  await open();
  await user.type(within(panel()).getByLabelText('Your meaning to save'), 'черновик');
  await user.click(within(panel()).getByRole('button', { name: 'Try 14 days free' }));
  act(() => {
    invalidateDataScope('adopt-anonymous');
    useAccount.setState({ status: 'authenticated', accountId: 'new-reader' });
  });
  await user.click(screen.getByRole('button', { name: 'Back to the word' }));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('черновик'));
  expect(currentWordReturn()).toBeNull();
  expect(api.claimTrial).not.toHaveBeenCalled(); expect(api.aiComplete).not.toHaveBeenCalled();
});
test('used trial and unknown access do not offer a fresh trial or quote a price for unknown access', async () => {
  useEntitlement.setState({ entitlement: { ...free, trialEndsAt: Date.now() - 1000 } });
  await open();
  expect(within(panel()).queryByRole('button', { name: 'Try 14 days free' })).toBeNull();
  expect(await within(panel()).findByRole('button', { name: /Get Pro/ })).toBeInTheDocument();
  act(() => useEntitlement.setState({ entitlement: null }));
  expect(within(panel()).getByRole('button', { name: 'Check access' })).toBeInTheDocument();
  expect(within(panel()).queryByText(/199/)).toBeNull();
  expect(api.claimTrial).not.toHaveBeenCalled();
});
test('completed AI answer stays readable after expiry without a fresh request or overwriting typed meaning', async () => {
  useEntitlement.setState({ entitlement: trial });
  await open();
  await within(panel()).findByText('мотыга Ещё: садовый инструмент');
  act(() => useEntitlement.setState({ entitlement: { ...free, trialEndsAt: Date.now() - 1 } }));
  expect(within(panel()).getByText('мотыга Ещё: садовый инструмент')).toBeInTheDocument();
  expect(within(panel()).queryByRole('button', { name: 'Get Pro' })).toBeNull();
  await user.click(within(panel()).getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'hoe' }));
  expect(within(panel()).getByText('мотыга Ещё: садовый инструмент')).toBeInTheDocument();
  expect(api.aiComplete).toHaveBeenCalledOnce();
});

test('a configured personal key offers direct AI instead of a trial; offline still allows manual saving', async () => {
  useAiStore.setState({ config: { provider: 'deepseek', apiKey: 'fixture-only-key', model: 'fixture-model' } });
  await open();
  expect(within(panel()).getByRole('button', { name: 'Refine meaning' })).toBeInTheDocument();
  expect(within(panel()).queryByRole('button', { name: 'Try 14 days free' })).toBeNull();
  expect(api.claimTrial).not.toHaveBeenCalled();
  act(() => useAiStore.setState({ config: null }));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => window.dispatchEvent(new Event('offline')));
  expect(await within(panel()).findByText(/You are offline/)).toBeInTheDocument();
  expect(within(panel()).queryByRole('button', { name: 'Try 14 days free' })).toBeNull();
  await user.type(within(panel()).getByLabelText('Your meaning to save'), 'офлайн');
  await user.click(within(panel()).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('word:hoe')).toMatchObject({ back: 'офлайн' }));
});

test('account handover fences an in-flight trial and never reopens the previous owner word', async () => {
  let resolve!: (value: typeof trial) => void;
  vi.mocked(api.claimTrial).mockImplementation(() => new Promise(done => { resolve = done; }));
  await open();
  await user.click(within(panel()).getByRole('button', { name: 'Try 14 days free' }));
  await user.click(screen.getByRole('button', { name: 'Start 14 days and translate' }));
  await waitFor(() => expect(api.claimTrial).toHaveBeenCalledOnce());
  act(() => { invalidateDataScope(); useAccount.setState({ accountId: 'another-reader', sessionRevision: useAccount.getState().sessionRevision + 1 }); });
  await act(async () => resolve(trial));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(currentWordReturn()).toBeNull();
  expect(api.aiComplete).not.toHaveBeenCalled();
});

test('the desktop word panel does not intercept Escape meant for the trial dialog', async () => {
  const media = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({ ...media(query), matches: query === '(min-width: 1200px)' }));
  await open();
  await user.click(within(panel()).getByRole('button', { name: 'Try 14 days free' }));
  const activation = screen.getByRole('dialog', { name: 'Try AI translation' });
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  fireEvent(within(activation).getByRole('button', { name: 'Close' }), escape);
  expect(escape.defaultPrevented).toBe(false);
  fireEvent(activation, new Event('cancel', { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Try AI translation' })).toBeNull());
  expect(within(panel()).getByLabelText('Your meaning to save')).toBeInTheDocument();
});
