import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Day } from '@/content/schema';
import { db } from '@/db/db';
import { installDialogMock } from '@/test/dialog';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { ProActivationDialog } from '@/features/account/ProActivationDialog';
import { useProActivation } from '@/features/account/proActivation';
import * as api from '@/features/account/api';
import { useAiStore } from '@/features/ai/store';
import { currentWordReturn } from '@/features/reader/word-return';
import { ReadingSectionView } from './ReadingSectionView';

const mocks = vi.hoisted(() => ({ translate: vi.fn() }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true, API_BASE: 'https://fixture.invalid' }));
vi.mock('@/features/vocab/translate', async original => ({ ...await original<object>(), translateWord: mocks.translate }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('@/features/vocab/lemma', async original => ({ ...await original<object>(), useLemma: () => ({ byForm: new Map(), lemmas: new Set() }) }));
vi.mock('@/features/vocab/cefr', async original => ({ ...await original<object>(), useCefr: () => new Map() }));

const day = Day.parse(JSON.parse(readFileSync('public/packs/dev-english-a2/days/u01.d02.json', 'utf8')));
const section = day.sections.find(s => s.type === 'reading');
if (!section || section.type !== 'reading') throw Error('u01.d02 reading fixture missing');
const free = { plan: 'free' as const, active: false, ai: { used: 0, limit: 0 } };
const trial = { plan: 'trial' as const, active: true, ai: { used: 0, limit: 10 } };
const sentence = 'She has got short hair and green eyes, and she wears glasses.';
const panel = () => screen.getByRole('dialog', { name: 'short' });
let user = userEvent.setup({ delay: null });
beforeEach(async () => {
  vi.restoreAllMocks(); installDialogMock(); invalidateDataScope(); localStorage.clear();
  useAccount.setState({ status: 'authenticated', accountId: 'lesson-owner', busy: false, getAccessToken: vi.fn().mockResolvedValue('fixture-token') });
  useProActivation.setState({ entry: null });
  useEntitlement.setState({ entitlement: free, loading: false, error: null });
  useAiStore.setState({ config: null });
  mocks.translate.mockReset().mockResolvedValue(null);
  vi.spyOn(api, 'billingPlans').mockResolvedValue({ available: true, plans: [{ code: 'pro_month', title: 'Month', days: 30, priceKopecks: 19900 }] });
  vi.spyOn(api, 'getEntitlement').mockResolvedValue(free);
  vi.spyOn(api, 'claimTrial').mockResolvedValue(trial);
  vi.spyOn(api, 'aiComplete').mockResolvedValue({ content: 'короткие\nЕщё: краткий', ai: { used: 1, limit: 10 }, cached: false });
  await db.open(); await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.translations.clear()]);
  user = userEvent.setup({ delay: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function open() {
  render(<MemoryRouter initialEntries={['/course/u01/day/u01.d02']}><ReadingSectionView section={section!} /><ProActivationDialog /></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: 'short' }));
}

test('u01.d02 short dictionary miss offers AI trial and free manual saving', async () => {
  await open();
  expect(await within(panel()).findByRole('button', { name: 'Try 14 days free' })).toBeInTheDocument();
  expect(within(panel()).getByText(sentence)).toBeInTheDocument();
  expect(api.claimTrial).not.toHaveBeenCalled(); expect(api.aiComplete).not.toHaveBeenCalled();
  await user.type(within(panel()).getByLabelText('Your meaning to save'), 'свой перевод');
  await user.click(within(panel()).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('word:short')).toMatchObject({ back: 'свой перевод', contextSentence: sentence }));
});
test.each(['pro', 'trial'] as const)('%s translates the selected lesson word automatically using its actual sentence', async plan => {
  useEntitlement.setState({ entitlement: { ...trial, plan } });
  await open();
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('короткие'));
  expect(api.aiComplete).toHaveBeenCalledWith('fixture-token', { task: 'wordInContext', word: 'short', sentence }, expect.any(AbortSignal));
  expect(within(panel()).queryByRole('button', { name: 'Try 14 days free' })).toBeNull();
});
test('a curated glossary translation stays free and the next word closes the previous popup', async () => {
  await open();
  await within(panel()).findByRole('button', { name: 'Try 14 days free' });
  await user.click(screen.getByRole('button', { name: 'colleague' }));
  expect(screen.queryByRole('dialog', { name: 'short' })).toBeNull();
  const known = screen.getByRole('dialog', { name: 'colleague' });
  expect(within(known).getByText('коллега')).toBeInTheDocument();
  expect(within(known).queryByRole('button', { name: 'Try 14 days free' })).toBeNull();
  expect(mocks.translate).toHaveBeenCalledTimes(1);
});
test('trial activation resumes short and requires explicit apply to replace a manual draft', async () => {
  await open();
  await user.type(within(panel()).getByLabelText('Your meaning to save'), 'черновик');
  await user.click(await within(panel()).findByRole('button', { name: 'Try 14 days free' }));
  await user.click(screen.getByRole('button', { name: 'Start 14 days and translate' }));
  await within(await screen.findByRole('dialog', { name: 'short' })).findByRole('button', { name: 'Apply translation' });
  expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('черновик');
  expect(await db.srsCards.count()).toBe(0);
  await user.click(within(panel()).getByRole('button', { name: 'Apply translation' }));
  expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('короткие');
  expect(api.claimTrial).toHaveBeenCalledOnce();
});
test('guest account adoption keeps the same lesson word/draft; owner handover clears both', async () => {
  useAccount.setState({ status: 'anonymous', accountId: null });
  await open();
  await user.type(within(panel()).getByLabelText('Your meaning to save'), 'мой черновик');
  await user.click(await within(panel()).findByRole('button', { name: 'Try 14 days free' }));
  act(() => { invalidateDataScope('adopt-anonymous'); useAccount.setState({ status: 'authenticated', accountId: 'created-owner' }); });
  await user.click(screen.getByRole('button', { name: 'Back to the word' }));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('мой черновик'));
  expect(currentWordReturn()).toBeNull();
  act(() => { invalidateDataScope(); useAccount.setState({ accountId: 'other-owner' }); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.claimTrial).not.toHaveBeenCalled(); expect(api.aiComplete).not.toHaveBeenCalled();
});
