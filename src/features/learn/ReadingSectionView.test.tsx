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
import { beginLessonWordReturn, currentWordReturn, readyWordReturn } from '@/features/reader/word-return';
import { useReaderSettings } from '@/features/reader/settings';
import { usePhraseSelect } from '@/features/reader/phrase-select';
import * as provider from '@/features/ai/provider';
import { ReadingSectionView } from './ReadingSectionView';

const mocks = vi.hoisted(() => ({ translate: vi.fn(), passage: vi.fn(), byok: vi.fn(), speech: false }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true, API_BASE: 'https://fixture.invalid' }));
vi.mock('@/features/vocab/translate', async original => ({ ...await original<object>(), translateWord: mocks.translate, translateText: mocks.passage }));
vi.mock('@/features/ai/provider', async original => ({ ...await original<object>(), complete: mocks.byok }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => mocks.speech }));
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
  useReaderSettings.setState({ aiTranslation: false });
  usePhraseSelect.getState().clear();
  mocks.speech = false;
  mocks.translate.mockReset().mockResolvedValue(null);
  mocks.passage.mockReset().mockResolvedValue('бесплатный перевод');
  mocks.byok.mockReset().mockResolvedValue('перевод собственного ключа');
  vi.spyOn(api, 'billingPlans').mockResolvedValue({ available: true, plans: [{ code: 'pro_month', title: 'Month', days: 30, priceKopecks: 19900 }] });
  vi.spyOn(api, 'getEntitlement').mockResolvedValue(free);
  vi.spyOn(api, 'claimTrial').mockResolvedValue(trial);
  vi.spyOn(api, 'aiComplete').mockImplementation(async (_token, request) => ({ content: request.task === 'translate' ? 'перевод подписки' : 'короткие\nЕщё: краткий', ai: { used: 1, limit: 10 }, cached: false }));
  await db.open(); await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.translations.clear()]);
  user = userEvent.setup({ delay: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function showLesson(reading = section!, pathname = '/course/u01/day/u01.d02') {
  render(<MemoryRouter initialEntries={[pathname]}><ReadingSectionView section={reading} /><ProActivationDialog /></MemoryRouter>);
}
async function open() {
  showLesson();
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

function access(mode: 'byok' | 'trial' | 'pro') {
  useEntitlement.setState({ entitlement: mode === 'byok' ? free : { ...trial, plan: mode } });
  if (mode === 'byok') useAiStore.setState({ config: { provider: 'deepseek', apiKey: 'fixture-only-key', model: provider.PROVIDERS.deepseek.model } });
}

test.each(['byok', 'trial', 'pro'] as const)('%s lesson sentence translation uses the chosen AI route without requiring another plan', async mode => {
  access(mode); showLesson();
  const origin = screen.getByRole('button', { name: 'short' }).closest('[data-sent]')!;
  await user.click(within(origin as HTMLElement).getByRole('button', { name: 'Sentence actions' }));
  const help = screen.getByRole('dialog', { name: 'Sentence help' });
  await user.click(within(help).getByRole('button', { name: 'Translation: free' }));
  await user.click(within(help).getByRole('button', { name: 'Translate' }));
  await within(help).findByText(mode === 'byok' ? 'перевод собственного ключа' : 'перевод подписки');
  expect(within(help).queryByText(/Get Pro|Try 14/)).toBeNull();
  if (mode === 'byok') {
    expect(mocks.byok).toHaveBeenCalledOnce(); expect(api.aiComplete).not.toHaveBeenCalled();
  } else expect(api.aiComplete).toHaveBeenCalledWith('fixture-token', { task: 'translate', text: sentence, sentence: undefined }, expect.any(AbortSignal));
  expect(await db.srsCards.count()).toBe(0);
});

test.each(['byok', 'trial', 'pro'] as const)('%s lesson phrase AI retains manual text and saves only after confirmation', async mode => {
  access(mode); await open();
  await user.click(within(panel()).getByRole('button', { name: 'Select a phrase from this word' }));
  await user.click(screen.getByRole('button', { name: 'hair' }));
  const help = await screen.findByRole('dialog', { name: 'short hair' });
  await waitFor(() => expect(within(help).getByLabelText('Your meaning to save')).toHaveValue('бесплатный перевод'));
  await user.clear(within(help).getByLabelText('Your meaning to save'));
  await user.type(within(help).getByLabelText('Your meaning to save'), 'мой вариант');
  await user.click(within(help).getByRole('button', { name: 'AI' }));
  await within(help).findByText(mode === 'byok' ? 'your AI key' : 'DayEnglish AI');
  expect(within(help).getByText(mode === 'byok' ? 'перевод собственного ключа' : 'перевод подписки')).toBeInTheDocument();
  expect(within(help).getByLabelText('Your meaning to save')).toHaveValue('мой вариант');
  expect(await db.srsCards.count()).toBe(0);
  await user.click(within(help).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('phrase:short hair')).toMatchObject({ back: 'мой вариант', contextSentence: sentence, contextGloss: 'мой вариант' }));
  if (mode === 'byok') { expect(mocks.byok).toHaveBeenCalledOnce(); expect(api.aiComplete).not.toHaveBeenCalled(); }
  else expect(vi.mocked(api.aiComplete).mock.calls.some(call => call[1].task === 'translate' && call[1].text === 'short hair' && call[1].sentence === sentence)).toBe(true);
});

test('phrase endpoints from different lesson blocks cannot reuse coincident token coordinates', async () => {
  await open();
  await user.click(within(panel()).getByRole('button', { name: 'Select a phrase from this word' }));
  await user.click(screen.getByRole('button', { name: 'colleague' }));
  expect(usePhraseSelect.getState().anchor).toBeNull();
  expect(screen.getByRole('dialog', { name: 'colleague' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'a new colleague' })).toBeNull();
});

test('keyboard and touch switches share one open lesson panel across blocks', async () => {
  await open();
  const colleague = screen.getByRole('button', { name: 'colleague' });
  act(() => colleague.focus());
  await user.keyboard('{Enter}');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'colleague' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(colleague).toHaveFocus();
  const tap = (target: HTMLElement) => user.pointer([{ keys: '[TouchA>]', target }, { keys: '[/TouchA]' }]);
  await tap(screen.getByRole('button', { name: 'short' }));
  await tap(colleague);
  expect(screen.queryByRole('dialog')).toBeNull();
  await tap(colleague);
  expect(screen.getByRole('dialog', { name: 'colleague' })).toBeInTheDocument();
});

test('legacy checkout target in a quoted later sentence restores the same lesson word and draft', async () => {
  const quotedDay = Day.parse(JSON.parse(readFileSync('public/packs/dev-english-a2/days/u03.d05.json', 'utf8')));
  const reading = quotedDay.sections.find(s => s.type === 'reading');
  if (!reading || reading.type !== 'reading') throw Error('Quoted reading missing');
  const pathname = '/course/u03/day/u03.d05';
  const id = beginLessonWordReturn({ pathname, sectionId: reading.id, blockId: reading.blocks[0]!.id, tokenIndex: 33, word: 'Could', manualDraft: 'отложенный черновик' });
  readyWordReturn(id);
  showLesson(reading, pathname);
  const help = await screen.findByRole('dialog', { name: 'Could' });
  expect(within(help).getByLabelText('Your meaning to save')).toHaveValue('отложенный черновик');
  expect(within(help).getByText(/Could you help me with this report/)).toBeInTheDocument();
  expect(currentWordReturn()).toBeNull();
  expect(api.aiComplete).not.toHaveBeenCalled();
});

test('free account with its own key can translate and explicitly save the lesson word', async () => {
  access('byok'); await open();
  await user.click(within(panel()).getByRole('button', { name: 'Refine meaning' }));
  await waitFor(() => expect(within(panel()).getByLabelText('Your meaning to save')).toHaveValue('перевод собственного ключа'));
  expect(await db.srsCards.count()).toBe(0);
  await user.click(within(panel()).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('word:short')).toMatchObject({ back: 'перевод собственного ключа', contextSentence: sentence }));
  expect(mocks.byok).toHaveBeenCalledOnce();
  expect(api.aiComplete).not.toHaveBeenCalled();
});

test.each(['byok', 'trial', 'pro'] as const)('%s phrase saves the displayed AI result without a manual draft', async mode => {
  access(mode); useReaderSettings.setState({ aiTranslation: true }); await open();
  await user.click(within(panel()).getByRole('button', { name: 'Select a phrase from this word' }));
  await user.click(screen.getByRole('button', { name: 'hair' }));
  const help = await screen.findByRole('dialog', { name: 'short hair' });
  const answer = mode === 'byok' ? 'перевод собственного ключа' : 'перевод подписки';
  await waitFor(() => expect(within(help).getByLabelText('Your meaning to save')).toHaveValue(answer));
  expect(await db.srsCards.count()).toBe(0);
  await user.click(within(help).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () => expect(await db.srsCards.get('phrase:short hair')).toMatchObject({ back: answer, contextSentence: sentence }));
});

test.each(['escape', 'close'] as const)('canceling a pending lesson phrase with %s aborts work and restores visible focus', async close => {
  access('byok'); await open();
  await user.click(within(panel()).getByRole('button', { name: 'Select a phrase from this word' }));
  const hair = screen.getByRole('button', { name: 'hair' });
  await user.click(hair);
  const help = await screen.findByRole('dialog', { name: 'short hair' });
  await within(help).findByText('бесплатный перевод');
  let finish!: (answer: string) => void;
  mocks.byok.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  await user.click(within(help).getByRole('button', { name: 'AI' }));
  await waitFor(() => expect(mocks.byok).toHaveBeenCalledOnce());
  const signal = mocks.byok.mock.calls[0]![2].signal as AbortSignal;
  if (close === 'escape') await user.keyboard('{Escape}');
  else await user.click(within(help).getByRole('button', { name: 'Close' }));
  expect(signal.aborted).toBe(true);
  expect(usePhraseSelect.getState().anchor).toBeNull();
  expect(hair).toHaveFocus();
  await act(async () => { finish('поздний перевод'); });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await db.srsCards.count()).toBe(0);
});

test('lesson recording, speed, pause and authored Russian translation remain independent of AI', async () => {
  mocks.speech = true;
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('play')); return Promise.resolve(); });
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { this.dispatchEvent(new Event('pause')); });
  showLesson();
  const audio = document.querySelector('audio')!;
  expect(audio.getAttribute('src')).toContain(section!.blocks[0]!.audio!.src);
  await user.click(screen.getByRole('radio', { name: '1.25×' }));
  expect(audio.playbackRate).toBe(1.25);
  await user.click(screen.getAllByRole('button', { name: 'Play paragraph' })[0]!);
  await user.click(await screen.findByRole('button', { name: 'Pause' }));
  expect(play).toHaveBeenCalledOnce(); expect(pause).toHaveBeenCalled();
  await user.click(screen.getAllByRole('button', { name: 'show translation' })[0]!);
  expect(screen.getByText(section!.blocks[0]!.ru!)).toBeInTheDocument();
  expect(api.aiComplete).not.toHaveBeenCalled(); expect(mocks.byok).not.toHaveBeenCalled();
});
