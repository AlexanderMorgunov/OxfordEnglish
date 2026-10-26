import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TextWorkbenchPage } from './TextWorkbenchPage';
import { VocabularyPage } from './VocabularyPage';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';
import { ApiFailure } from '@/features/account/api';
import { usePassageTranslation } from '@/features/vocab/usePassageTranslation';
import { translatePassage } from '@/features/vocab/text-workbench';
import { invalidateDataScope } from '@/features/account/dataScope';
import { db } from '@/db/db';
import { useAiStore } from '@/features/ai/store';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { useReaderSettings } from '@/features/reader/settings';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { useSavedPhrases } from '@/features/reader/saved-phrases';
import { usePhraseSelect } from '@/features/reader/phrase-select';
import { AiCacheMiss } from '@/features/ai/cache';
import * as audio from '@/shared/lib/audio';
import { probeDictation, startDictation } from '@/features/vocab/dictation';

vi.mock('@/features/vocab/text-workbench', async (original) => ({ ...(await original<object>()), translatePassage: vi.fn() }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => true }));
vi.mock('@/features/vocab/dictation', () => ({ probeDictation: vi.fn(), startDictation: vi.fn(), installDictation: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
const sentence = 'Take care near the river bank.';
beforeEach(async () => {
  invalidateDataScope();
  vi.mocked(translatePassage).mockReset();
  vi.mocked(probeDictation).mockReset().mockResolvedValue({ local: 'ready', system: true, install: false, native: false });
  vi.mocked(startDictation).mockReset();
  useAiStore.setState({ config: null });
  useAccount.setState({ status: 'anonymous', accountId: null });
  useEntitlement.setState({ entitlement: null });
  useReaderSettings.setState({ aiTranslation: false });
  useVocabStore.setState({ statuses: new Map(), ready: false });
  useSavedPhrases.setState({ phrases: new Set(), ready: true });
  usePhraseSelect.getState().clear();
  await db.open();
  await Promise.all([db.settings, db.srsCards, db.wordStatus, db.pending, db.activity, db.reviewLog, db.translations].map(table => table.clear()));
  await db.translations.bulkPut([{ word: 'bank', ru: 'берег', source: 'manual' }, { word: 'take care', ru: 'береги себя', source: 'manual' }]);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ words: [], map: {}, levels: [] }))));
  vi.spyOn(audio, 'listEnglishVoices').mockReturnValue([]);
  vi.spyOn(audio, 'subscribeVoices').mockReturnValue(() => {});
  vi.spyOn(audio, 'cancelSpeech').mockImplementation(() => {});
  vi.spyOn(audio, 'speakPassage').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function(this: HTMLElement) { return this.closest('[hidden]') ? [] as unknown as DOMRectList : [new DOMRect()] as unknown as DOMRectList; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function compose(text = sentence) {
  const page = render(<TextWorkbenchPage />, { wrapper: MemoryRouter });
  fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: text } });
  return page;
}
const translate = () => userEvent.click(screen.getByRole('button', { name: /^Translate(?: again)?$|^Check saved AI translation$/ }));
async function openDisclosure(label: string) {
  const summary = screen.getByText(label, { selector: 'summary' });
  if (!summary.closest('details')?.open) await userEvent.click(summary);
}
async function editSource() {
  if (!screen.queryByRole('button', { name: 'Edit source' })) await openDisclosure('Translation actions');
  await userEvent.click(screen.getByRole('button', { name: 'Edit source' }));
}
async function editTranslation() { await openDisclosure('Translation actions'); await userEvent.click(screen.getByRole('button', { name: 'Edit translation' })); }
async function readSource() { if (!screen.queryByRole('button', { name: 'Read source' })) await openDisclosure('More input options'); await userEvent.click(screen.getByRole('button', { name: 'Read source' })); }
async function read(text = sentence) { const page = await compose(text); await readSource(); return page; }
async function selectMode(mode: 'free' | 'ai') {
  const select = screen.getByLabelText('Translation mode');
  const details = select.closest('details');
  if (details && !details.open) await userEvent.click(details.querySelector('summary')!);
  await userEvent.selectOptions(select, mode);
}

test('the production workbench has no example filler or redundant vocabulary link', async () => {
  await compose();
  expect(screen.queryByRole('button', { name: 'Example' })).toBeNull();
  expect(screen.queryByText(/try the example/i)).toBeNull();
  await readSource();
  expect(screen.queryByRole('link', { name: 'Open my vocabulary' })).toBeNull();
  expect(screen.getByRole('link', { name: 'My vocabulary' })).toBeVisible();
});

test('retry after switching AI to free uses the selected mode and original result source', async () => {
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture-only', model: 'fixture', baseUrl: 'https://fixture.invalid' } });
  vi.mocked(translatePassage).mockRejectedValueOnce(new Error('Synthetic AI outage')).mockResolvedValueOnce('Бесплатный перевод');
  await compose('The original sentence.'); await translate(); await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('tab', { name: 'Source and words' }));
  await selectMode('free');
  await userEvent.click(screen.getByRole('tab', { name: 'Translation' }));
  await userEvent.click(screen.getByRole('button', { name: /Retry translation|Translate for free/ }));
  expect(await screen.findByText('Бесплатный перевод')).toBeVisible();
  expect(vi.mocked(translatePassage).mock.calls.map(([source, options]) => ({ source, mode: options.mode }))).toEqual([
    { source: 'The original sentence.', mode: 'ai' }, { source: 'The original sentence.', mode: 'free' },
  ]);
  expect(vi.mocked(translatePassage).mock.calls[1]?.[1].resume).not.toBe(vi.mocked(translatePassage).mock.calls[0]?.[1].resume);
});

test('an AI service failure offers a deliberate free choice without sending it automatically', async () => {
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture-only', model: 'fixture', baseUrl: 'https://fixture.invalid' } });
  vi.mocked(translatePassage).mockRejectedValueOnce(new Error('Synthetic provider outage')).mockResolvedValueOnce('Бесплатно');
  await compose(); await translate(); await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Choose free translation' }));
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue(sentence);
  expect(screen.getByLabelText('Translation mode')).toHaveValue('free');
  expect(translatePassage).toHaveBeenCalledOnce();
  await translate(); expect(await screen.findByText('Бесплатно')).toBeVisible();
  expect(vi.mocked(translatePassage).mock.calls[1]?.[1].mode).toBe('free');
});

test.each(['mode', 'source'] as const)('the translation hook rejects stale resume text when %s changes', async change => {
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture-only', model: 'fixture', baseUrl: 'https://fixture.invalid' } });
  const next = deferred<string>();
  vi.mocked(translatePassage).mockImplementationOnce(async (_source, options) => {
    options.onProgress?.('Старый ответ', ['byok'], { completed: 1, total: 2 }); throw new Error('Synthetic outage');
  }).mockImplementationOnce((_source, options) => { options.onProgress?.('', [], { completed: 0, total: 1 }); return next.promise; });
  const hook = renderHook(() => usePassageTranslation());
  await act(async () => { await hook.result.current.start(sentence, 'ai'); });
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.start(change === 'source' ? 'A new original.' : sentence, change === 'mode' ? 'free' : 'ai', true); });
  expect(hook.result.current.result).toMatchObject({ state: 'loading', text: '', completed: 0, paths: [] });
  expect(vi.mocked(translatePassage).mock.calls[1]?.[1].resume).not.toBe(vi.mocked(translatePassage).mock.calls[0]?.[1].resume);
  await act(async () => { next.resolve('Новый ответ'); await pending; });
});

test('changing mode on a partial retry restarts instead of mixing AI and free fragments', async () => {
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture-only', model: 'fixture', baseUrl: 'https://fixture.invalid' } });
  const pending = deferred<string>();
  vi.mocked(translatePassage).mockImplementationOnce(async (_source, options) => {
    options.onProgress?.('Старая часть AI', ['byok'], { completed: 1, total: 2 }); throw new Error('Synthetic outage');
  }).mockReturnValueOnce(pending.promise);
  await compose(); await translate(); await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('tab', { name: 'Source and words' })); await selectMode('free');
  await userEvent.click(screen.getByRole('tab', { name: 'Translation' }));
  await userEvent.click(screen.getByRole('button', { name: /Continue translation|Translate for free/ }));
  expect(screen.queryByText('Старая часть AI')).toBeNull();
  expect(vi.mocked(translatePassage).mock.calls[1]?.[1].mode).toBe('free');
  await act(async () => pending.resolve('Новый полный перевод'));
  expect(screen.getByText('Новый полный перевод')).toBeVisible();
});

test('AI without a plan or key is visibly locked and offers Pro or key setup before a request', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Сохранённый перевод');
  await compose(); await selectMode('ai');
  expect(screen.getByRole('link', { name: 'AI in Pro →' })).toHaveAttribute('href', '/pro');
  expect(screen.getByRole('link', { name: 'Set up your own AI key →' })).toHaveAttribute('href', '/settings?from=%2Fvocabulary%2Ftext#ai-section');
  expect(screen.getByRole('option', { name: /🔒 AI translation/ })).toBeInTheDocument();
  expect(translatePassage).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Check saved AI translation' }));
  expect(await screen.findByText('Сохранённый перевод')).toBeVisible();
  expect(translatePassage).toHaveBeenCalledWith(sentence, expect.objectContaining({ mode: 'ai', cacheOnly: true }));
});

test('an unavailable saved AI answer explains a cache miss and offers the free path', async () => {
  vi.mocked(translatePassage).mockRejectedValue(new AiCacheMiss());
  await compose(); await selectMode('ai'); await translate();
  expect(await screen.findByRole('alert')).toHaveTextContent('The full AI translation is not saved on this device');
  expect(screen.getByRole('link', { name: 'AI in Pro →' })).toBeVisible();
  expect(screen.queryByText(/Translation unavailable. Check connectivity/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Choose free translation' }));
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue(sentence);
  expect(screen.getByLabelText('Translation mode')).toHaveValue('free');
  expect(translatePassage).toHaveBeenCalledOnce();
});

test.each(['pro', 'trial'] as const)('active %s without a key can request a new AI translation', async plan => {
  useAccount.setState({ status: 'authenticated', accountId: 'fixture-owner' });
  useEntitlement.setState({ entitlement: { plan, active: true, ai: { used: 0, limit: 100 } } });
  vi.mocked(translatePassage).mockResolvedValue('Ответ по подписке');
  await compose(); await translate();
  expect(await screen.findByText('Ответ по подписке')).toBeVisible();
  expect(translatePassage).toHaveBeenCalledWith(sentence, expect.objectContaining({ mode: 'ai', config: null, cacheOnly: false }));
  expect(screen.queryByRole('link', { name: 'AI in Pro →' })).toBeNull();
});

test('spent paid quota reuses the reset hint instead of asking the subscriber to buy Pro', async () => {
  const now = Date.now();
  useAccount.setState({ status: 'authenticated', accountId: 'fixture-owner' });
  useEntitlement.setState({ entitlement: { plan: 'pro', active: true, paidUntil: now + 60 * 86400000, ai: { used: 100, limit: 100, resetsAt: now + 30 * 86400000 } } });
  await compose(); await selectMode('ai');
  expect(screen.getByText(/AI budget spent, resets on/)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'AI in Pro →' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Check saved AI translation' })).toBeVisible();
});

test('a personal key permits a new AI request without a subscription', async () => {
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture-only', model: 'fixture', baseUrl: 'https://fixture.invalid' } });
  vi.mocked(translatePassage).mockResolvedValue('Ответ по ключу');
  await compose(); await translate();
  expect(await screen.findByText('Ответ по ключу')).toBeVisible();
  expect(translatePassage).toHaveBeenCalledWith(sentence, expect.objectContaining({ mode: 'ai', cacheOnly: false }));
});

test('clearing source is reversible without requesting a translation', async () => {
  await compose();
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: 'Restore text' }));
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue(sentence);
  expect(translatePassage).not.toHaveBeenCalled();
});

test('cancelling source changes restores the draft and keeps its previous translation', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Сохранённый перевод');
  await compose(); await translate(); await screen.findByText('Сохранённый перевод');
  await editSource();
  fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: 'Changed source.' } });
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel source changes' }));
  expect(screen.getByText('Сохранённый перевод')).toBeVisible();
  await editSource();
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue(sentence);
  expect(translatePassage).toHaveBeenCalledOnce();
});

test('reading without translation keeps an explicit translate action available', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Перевод прочитанного');
  await read(); expect(translatePassage).not.toHaveBeenCalled();
  await translate();
  expect(await screen.findByText('Перевод прочитанного')).toBeVisible();
  expect(translatePassage).toHaveBeenCalledWith(sentence, expect.objectContaining({ mode: 'free' }));
});

test('mobile source and translation tabs support arrows, Home and End without a new request', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Перевод');
  await compose(); await translate(); await screen.findByText('Перевод');
  const source = screen.getByRole('tab', { name: 'Source and words' });
  const translated = screen.getByRole('tab', { name: 'Translation' });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Translation RU' })).toHaveFocus());
  translated.focus(); await userEvent.keyboard('{ArrowLeft}');
  expect(source).toHaveAttribute('aria-selected', 'true'); expect(source).toHaveFocus();
  expect(screen.getByRole('button', { name: 'bank' })).toBeVisible();
  await userEvent.keyboard('{End}');
  expect(translated).toHaveAttribute('aria-selected', 'true'); expect(translated).toHaveFocus();
  await userEvent.keyboard('{Home}');
  expect(source).toHaveFocus(); expect(translatePassage).toHaveBeenCalledOnce();
});

test('switching tabs cannot hide an unconfirmed translation edit', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Перевод');
  await compose(); await translate(); await screen.findByText('Перевод'); await editTranslation();
  fireEvent.change(screen.getByLabelText('Russian translation'), { target: { value: 'Мой черновик' } });
  await userEvent.click(screen.getByRole('tab', { name: 'Source and words' }));
  expect(screen.getByLabelText('Russian translation')).toHaveValue('Мой черновик');
  expect(screen.getByRole('tab', { name: 'Translation' })).toHaveAttribute('aria-selected', 'true');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toHaveFocus());
});

test('retranslation from result actions uses its source rather than an unsent draft', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Перевод');
  await compose('Original text.'); await translate(); await screen.findByText('Перевод'); await editSource();
  fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: 'Unsent source.' } });
  act(() => useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture-only', model: 'fixture', baseUrl: 'https://fixture.invalid' } }));
  await selectMode('ai');
  await userEvent.click(screen.getByRole('button', { name: 'Back to translation' }));
  await openDisclosure('Translation actions');
  await userEvent.click(screen.getByRole('button', { name: 'Retranslate source' }));
  await waitFor(() => expect(translatePassage).toHaveBeenCalledTimes(2));
  expect(vi.mocked(translatePassage).mock.calls.map(call => call[0])).toEqual(['Original text.', 'Original text.']);
  expect(vi.mocked(translatePassage).mock.calls[1]?.[1].mode).toBe('ai');
  await screen.findByText('Перевод'); await editSource();
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue('Unsent source.');
});

test('closing input options cancels hidden dictation and ignores its late result', async () => {
  await compose(); await openDisclosure('More input options');
  const transcript = deferred<string>(); const cancel = vi.fn();
  vi.mocked(startDictation).mockReturnValue({ result: transcript.promise, cancel, stop: vi.fn() });
  await userEvent.click(screen.getByRole('button', { name: 'Dictate in English' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  await userEvent.click(screen.getByText('More input options', { selector: 'summary' }));
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  await act(async () => transcript.resolve('Late dictation.'));
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue(sentence);
  expect(screen.queryByLabelText('Check dictated text')).toBeNull();
});

test('an owner change clears source undo and its edit checkpoint', async () => {
  await compose(); await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  act(() => invalidateDataScope());
  expect(screen.queryByRole('button', { name: 'Restore text' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue('');
});

test('an old clear callback cannot publish private undo during an owner transition', async () => {
  await compose();
  const clear = screen.getByRole('button', { name: 'Clear' });
  act(() => { invalidateDataScope(); fireEvent.click(clear); });
  expect(screen.queryByRole('button', { name: 'Restore text' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue('');
});

test('cancelling a replacement returns focus to the surviving actions disclosure', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Перевод');
  await compose(); await translate(); await screen.findByText('Перевод'); await editTranslation();
  await userEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await openDisclosure('Translation actions');
  await userEvent.click(screen.getByRole('button', { name: 'Retranslate source' }));
  await userEvent.click(screen.getByRole('button', { name: 'Keep edits' }));
  await waitFor(() => expect(screen.getByText('Translation actions', { selector: 'summary' })).toHaveFocus());
  expect(translatePassage).toHaveBeenCalledOnce();
});

test('an empty manual edit cannot erase the confirmed translation', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Прежний перевод');
  await compose(); await translate(); await screen.findByText('Прежний перевод'); await editTranslation();
  fireEvent.change(screen.getByLabelText('Russian translation'), { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeDisabled();
  expect(screen.getByLabelText('Russian translation')).toHaveAttribute('aria-invalid', 'true');
  await userEvent.click(screen.getByRole('tab', { name: 'Source and words' }));
  await waitFor(() => expect(screen.getByLabelText('Russian translation')).toHaveFocus());
  await userEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
  expect(screen.getByText('Прежний перевод')).toBeVisible();
  expect(translatePassage).toHaveBeenCalledOnce();
});

test('page recovery aborts a user-started AI translation and never replays it', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const pending = deferred<string>();
  vi.mocked(translatePassage).mockReturnValue(pending.promise);
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'test-only', model: 'test-only', baseUrl: 'https://test.invalid' } });
  function Sibling({ broken }: { broken: boolean }) { if (broken) throw new Error('Synthetic page failure'); return null; }
  const tree = (broken: boolean) => <MemoryRouter><main tabIndex={-1}><ErrorBoundary resetKey="/vocabulary/text"><TextWorkbenchPage /><Sibling broken={broken} /></ErrorBoundary></main></MemoryRouter>;
  const view = render(tree(false));
  fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: sentence } });
  await selectMode('ai');
  await translate();
  expect(translatePassage).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(translatePassage).mock.calls[0]![1].signal;
  view.rerender(tree(true));
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(signal.aborted).toBe(true);
  view.rerender(tree(false));
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('heading', { name: 'Translate text' });
  await act(async () => pending.resolve('Late synthetic paid response'));
  expect(screen.queryByText('Late synthetic paid response')).not.toBeInTheDocument();
  expect(translatePassage).toHaveBeenCalledTimes(1);
});

test.each(['input', 'result', 'pending'] as const)('vocabulary sections allow returning from the translator in its %s state', async state => {
  const pending = deferred<string>();
  vi.mocked(translatePassage).mockReturnValue(state === 'pending' ? pending.promise : Promise.resolve('Готовый ответ'));
  render(<MemoryRouter initialEntries={['/vocabulary']}><Routes>
    <Route path="/vocabulary" element={<VocabularyPage />} />
    <Route path="/vocabulary/text" element={<TextWorkbenchPage />} />
  </Routes></MemoryRouter>);
  await screen.findByRole('heading', { name: 'My vocabulary' });
  await userEvent.click(screen.getByRole('link', { name: 'Translate text' }));
  expect(screen.getByRole('heading', { name: 'Translate text' })).toBeInTheDocument();
  if (state !== 'input') {
    fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: sentence } });
    await translate();
    if (state === 'result') await screen.findByText('Готовый ответ');
  }
  const nav = within(screen.getByRole('navigation', { name: 'Vocabulary sections' }));
  expect(nav.getByRole('link', { name: 'Translate text' })).toHaveAttribute('aria-current', 'page');
  await userEvent.click(nav.getByRole('link', { name: 'My vocabulary' }));
  await screen.findByRole('heading', { name: 'My vocabulary' });
  expect(within(screen.getByRole('navigation', { name: 'Vocabulary sections' })).getByRole('link', { name: 'My vocabulary' })).toHaveAttribute('aria-current', 'page');
  if (state === 'pending') {
    expect(vi.mocked(translatePassage).mock.calls[0]?.[1].signal.aborted).toBe(true);
    await act(async () => pending.resolve('Запоздалый ответ'));
    expect(screen.queryByText('Запоздалый ответ')).toBeNull();
  }
});

test('switching vocabulary sections retains the return to the originating book', async () => {
  localStorage.setItem('reader.lastPath', '/library/example');
  try {
    render(<MemoryRouter initialEntries={['/vocabulary?from=reader']}><Routes>
      <Route path="/vocabulary" element={<VocabularyPage />} />
      <Route path="/vocabulary/text" element={<TextWorkbenchPage />} />
      <Route path="/library/example" element={<h1>Originating book</h1>} />
    </Routes></MemoryRouter>);
    await userEvent.click(screen.getByRole('link', { name: 'Translate text' }));
    expect(screen.getByRole('button', { name: /back to reading/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'My vocabulary' }));
    await userEvent.click(screen.getByRole('button', { name: /back to reading/ }));
    expect(screen.getByRole('heading', { name: 'Originating book' })).toBeInTheDocument();
  } finally { localStorage.removeItem('reader.lastPath'); }
});

test('mobile composer translates explicitly and presents prose rather than another form', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Готовый перевод');
  await compose(); await translate();
  expect(await screen.findByText('Готовый перевод')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'English text' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Russian translation' })).toBeNull();
  expect(translatePassage).toHaveBeenCalledWith(sentence, expect.objectContaining({ mode: 'free' }));
  await userEvent.click(screen.getByRole('tab', { name: 'Source and words' }));
  expect(screen.getByRole('button', { name: 'bank' })).toBeInTheDocument();
  expect(translatePassage).toHaveBeenCalledOnce();
});

test('reading without translation uses real word and phrase saves with original context', async () => {
  await read(); expect(translatePassage).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'bank' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'bank' })).getByRole('button', { name: 'learning' }));
  await waitFor(async () => expect(await db.srsCards.get('word:bank')).toMatchObject({ back: 'берег', contextSentence: sentence }));
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Take' }));
  await userEvent.click(screen.getByRole('button', { name: 'select phrase →' }));
  await userEvent.click(screen.getByRole('button', { name: 'care' }));
  await userEvent.click(screen.getByRole('button', { name: '+ save' }));
  await screen.findByRole('button', { name: '✓ saved' });
  expect(await db.srsCards.get('phrase:take care')).toMatchObject({ back: 'береги себя', contextSentence: sentence });
  expect((await db.settings.toArray()).filter(row => row.key.startsWith('reader-term:'))).toEqual([]);
});

test('changing the composer then reading follows the new draft, while the old answer keeps its source', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Первый ответ');
  await compose('First original.'); await translate(); await screen.findByText('Первый ответ');
  await editSource(); fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: 'Second original.' } });
  await readSource();
  expect(screen.getByRole('button', { name: 'Second' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'First' })).toBeNull();
  expect(screen.queryByText('Show matching translation')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Back to translation' }));
  expect(screen.getByText('Первый ответ')).toBeInTheDocument();
  expect(screen.getByText(/answer belongs to the previous source/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: 'Source and words' }));
  expect(screen.getByRole('button', { name: 'First' })).toBeInTheDocument();
});

test('Russian editing is explicit; cancel restores confirmed content and copy uses committed edits', async () => {
  const writeText = vi.fn(async () => {}); vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  vi.mocked(translatePassage).mockResolvedValue('Исходный перевод');
  await compose(); await translate(); await screen.findByText('Исходный перевод');
  await editTranslation();
  fireEvent.change(screen.getByLabelText('Russian translation'), { target: { value: 'Черновик' } });
  await userEvent.click(screen.getByRole('button', { name: 'Cancel edit' }));
  expect(screen.getByText('Исходный перевод')).toBeInTheDocument();
  await editTranslation();
  fireEvent.change(screen.getByLabelText('Russian translation'), { target: { value: 'Исправленный перевод' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await userEvent.click(screen.getByRole('button', { name: 'Copy translation' }));
  expect(writeText).toHaveBeenCalledWith('Исправленный перевод');
});

test('source navigation cannot hide an unfinished Russian editor', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Перевод');
  await compose(); await translate(); await screen.findByText('Перевод');
  await editTranslation();
  fireEvent.change(screen.getByLabelText('Russian translation'), { target: { value: 'Черновик' } });
  await editSource();
  expect(screen.getByLabelText('Russian translation')).toHaveValue('Черновик');
  expect(screen.queryByRole('textbox', { name: 'English text' })).toBeNull();
  expect(screen.getByText(/Finish or cancel your edit first/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save edit' })).toHaveFocus());
});

test('regeneration requires deliberate replacement of confirmed manual edits', async () => {
  vi.mocked(translatePassage).mockResolvedValueOnce('Первый').mockResolvedValueOnce('Второй');
  await compose(); await translate(); await screen.findByText('Первый');
  await editTranslation();
  fireEvent.change(screen.getByLabelText('Russian translation'), { target: { value: 'Мои правки' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await editSource(); await translate();
  expect(screen.getByRole('dialog', { name: 'Replace your edits?' })).toBeInTheDocument();
  expect(translatePassage).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Keep edits' }));
  await userEvent.click(screen.getByRole('button', { name: 'Back to translation' }));
  expect(screen.getByText('Мои правки')).toBeInTheDocument();
  await editSource(); await translate();
  await userEvent.click(screen.getByRole('button', { name: 'Replace and translate' }));
  expect(await screen.findByText('Второй')).toBeInTheDocument();
  expect(translatePassage).toHaveBeenCalledTimes(2);
});

test('partial output is readable, accurately counted and copied with an incomplete label', async () => {
  vi.mocked(translatePassage).mockImplementationOnce(async (_text, opts) => { opts.onProgress?.('Готовая часть', ['managed', 'byok'], { completed: 2, total: 3 }); throw new Error('outage'); });
  const writeText = vi.fn(async () => {}); vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  await compose(); await selectMode('ai'); await translate();
  expect(await screen.findByRole('alert')).toHaveTextContent('Part of the text is translated');
  expect(screen.getByText('Готовая часть')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Russian translation' })).toBeNull();
  expect(screen.getByText('Incomplete: 2 of 3 parts.')).toBeInTheDocument();
  expect(screen.getByText('Received via DayEnglish AI + your AI key')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy completed part' }));
  expect(writeText).toHaveBeenCalledWith('Готовая часть');
  expect(await screen.findByText('Completed part copied. Translation is incomplete.')).toBeInTheDocument();
});

test('retry preserves completed text during an initial zero-progress callback and does not auto-run online', async () => {
  const pending = deferred<string>();
  vi.mocked(translatePassage).mockImplementationOnce(async (_text, opts) => { opts.onProgress?.('Первая часть', [], { completed: 1, total: 2 }); throw new Error('outage'); })
    .mockImplementationOnce((_text, opts) => { opts.onProgress?.('', [], { completed: 0, total: 2 }); return pending.promise; });
  await compose(); await translate(); await screen.findByText('Первая часть');
  fireEvent(window, new Event('online')); expect(translatePassage).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Continue translation' }));
  expect(screen.getByText('Первая часть')).toBeInTheDocument();
  expect(vi.mocked(translatePassage).mock.calls[1]?.[1].resume).toBe(vi.mocked(translatePassage).mock.calls[0]?.[1].resume);
  await act(async () => pending.resolve('Полный перевод'));
  expect(screen.getByText('Полный перевод')).toBeInTheDocument();
});

test('continuation uses the old source snapshot after the draft changes', async () => {
  vi.mocked(translatePassage).mockImplementationOnce(async (_text, opts) => { opts.onProgress?.('Часть', [], { completed: 1, total: 2 }); throw new Error('outage'); }).mockResolvedValueOnce('Полный старый перевод');
  await compose('Old original.'); await translate(); await screen.findByText('Часть');
  await editSource(); fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: 'New original.' } });
  await userEvent.click(screen.getByRole('button', { name: 'Back to translation' }));
  await userEvent.click(screen.getByRole('button', { name: 'Continue translation' }));
  expect(await screen.findByText('Полный старый перевод')).toBeInTheDocument();
  expect(vi.mocked(translatePassage).mock.calls.map(call => call[0])).toEqual(['Old original.', 'Old original.']);
});

test.each(['cancel', 'owner', 'unmount'] as const)('%s aborts the active job and ignores late output', async action => {
  const pending = deferred<string>(); vi.mocked(translatePassage).mockReturnValue(pending.promise);
  const page = await compose(); await translate();
  const signal = vi.mocked(translatePassage).mock.calls[0]?.[1].signal;
  if (action === 'cancel') await userEvent.click(screen.getByRole('button', { name: 'Cancel translation' }));
  if (action === 'owner') act(() => invalidateDataScope());
  if (action === 'unmount') page.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve('Старый результат'));
  expect(screen.queryByText('Старый результат')).toBeNull();
  if (action === 'owner') expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue('');
});

test('late progress and the old finalizer cannot replace a newer job', async () => {
  const old = deferred<string>(), next = deferred<string>();
  vi.mocked(translatePassage).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  await compose(); await translate(); await userEvent.click(screen.getByRole('button', { name: 'Cancel translation' }));
  await userEvent.click(screen.getByRole('button', { name: 'Retry translation' }));
  await act(async () => { vi.mocked(translatePassage).mock.calls[0]?.[1].onProgress?.('Запоздалый', [], { completed: 1, total: 1 }); old.resolve('Запоздалый'); });
  expect(screen.queryByText('Запоздалый')).toBeNull();
  expect(screen.getByRole('button', { name: 'Cancel translation' })).toBeInTheDocument();
  await act(async () => next.resolve('Актуальный'));
  expect(screen.getByText('Актуальный')).toBeInTheDocument();
});

test('a failed request retains source and can be retried without restarting the page', async () => {
  vi.mocked(translatePassage).mockRejectedValueOnce(new Error('outage')).mockResolvedValueOnce('Восстановленный');
  await compose(); await translate(); expect(await screen.findByRole('alert')).toHaveTextContent('Your source text is retained');
  await userEvent.click(screen.getByRole('button', { name: 'Retry translation' }));
  expect(await screen.findByText('Восстановленный')).toBeInTheDocument();
  expect(translatePassage).toHaveBeenCalledTimes(2);
});

test('over-limit and invalid input is retained without calls or a misleading reading view', async () => {
  const text = 'a'.repeat(2001); await compose(text); await translate();
  expect(screen.getByRole('alert')).toHaveTextContent('Your text has not been cut');
  await readSource();
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue(text);
  expect(translatePassage).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: 'Русский текст' } });
  await translate(); expect(screen.getByRole('alert')).toHaveTextContent('Paste English text');
});

test('Ctrl+Enter translates while ordinary Enter is left as a newline', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Перевод'); await compose();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'English text' }), { key: 'Enter' });
  expect(translatePassage).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'English text' }), { key: 'Enter', ctrlKey: true });
  expect(await screen.findByText('Перевод')).toBeInTheDocument();
});

test('AI remains usable for Pro without a key and its caption reacts to entitlement recovery', async () => {
  useAccount.setState({ status: 'authenticated', accountId: 'test-owner' });
  vi.mocked(translatePassage).mockResolvedValue('Ответ Pro'); await compose();
  expect(screen.getByLabelText('Translation mode')).toHaveValue('ai');
  expect(screen.getByText('AI access is checked when you translate.')).toBeInTheDocument();
  act(() => useEntitlement.setState({ entitlement: { plan: 'pro', active: true, ai: { used: 0, limit: 100 } } }));
  expect(screen.getByText('Pro · uses your account budget. No personal key needed.')).toBeInTheDocument();
  await translate(); expect(await screen.findByText('Ответ Pro')).toBeInTheDocument();
  expect(translatePassage).toHaveBeenCalledWith(sentence, expect.objectContaining({ mode: 'ai', config: null }));
});

test('expired AI users can explicitly read a cached translation without a key', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Сохранённый'); await compose();
  await selectMode('ai'); await translate();
  expect(await screen.findByText('Сохранённый')).toBeInTheDocument();
});

test('changing a key leaves free translation running but cancels AI work without losing its partial text', async () => {
  const first = deferred<string>(); vi.mocked(translatePassage).mockReturnValueOnce(first.promise);
  await compose(); await translate(); const freeSignal = vi.mocked(translatePassage).mock.calls[0]?.[1].signal;
  act(() => useAiStore.setState({ config: { provider: 'custom', apiKey: 'test-only', model: 'test-only', baseUrl: 'https://test.invalid' } }));
  expect(freeSignal?.aborted).toBe(false); await act(async () => first.resolve('Бесплатный'));
  await editSource(); await selectMode('ai');
  const ai = deferred<string>(); vi.mocked(translatePassage).mockImplementationOnce((_text, opts) => { opts.onProgress?.('Часть AI', ['managed'], { completed: 1, total: 2 }); return ai.promise; });
  await translate(); const aiSignal = vi.mocked(translatePassage).mock.calls[1]?.[1].signal;
  act(() => useAiStore.getState().forgetKey('custom'));
  expect(aiSignal?.aborted).toBe(true); expect(screen.getByText('Часть AI')).toBeInTheDocument();
  await act(async () => ai.resolve('Устаревший')); expect(screen.queryByText('Устаревший')).toBeNull();
});

test('a late clipboard completion cannot claim a partial copy was the completed result', async () => {
  const translation = deferred<string>(), copied = deferred<void>();
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(() => copied.promise) } });
  vi.mocked(translatePassage).mockImplementation((_text, opts) => { opts.onProgress?.('Часть', [], { completed: 1, total: 2 }); return translation.promise; });
  await compose(); await translate(); await userEvent.click(screen.getByRole('button', { name: 'Copy completed part' }));
  await act(async () => { translation.resolve('Полный'); copied.resolve(); });
  expect(screen.getByText('Полный')).toBeInTheDocument();
  expect(screen.queryByText('Copied.')).toBeNull();
  expect(screen.queryByText('Completed part copied. Translation is incomplete.')).toBeNull();
});

test('paste denial is recoverable and late clipboard acquisition cannot overwrite new typing', async () => {
  const pending = deferred<string>(); vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: vi.fn().mockRejectedValueOnce(new Error('denied')).mockReturnValueOnce(pending.promise) } });
  await compose(); await userEvent.click(screen.getByRole('button', { name: 'Paste' }));
  expect(await screen.findByText(/Clipboard unavailable.*Ctrl\+V/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Paste' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'English text' }), { target: { value: 'New typed text.' } });
  await act(async () => pending.resolve('Old clipboard.'));
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue('New typed text.');
  expect(translatePassage).not.toHaveBeenCalled();
});

test('read-aloud and portaled word popups close when returning to source editing', async () => {
  await read(); await userEvent.click(screen.getByRole('button', { name: 'Read aloud from here' }));
  expect(audio.speakPassage).toHaveBeenCalledWith(sentence, expect.anything());
  await userEvent.click(screen.getByRole('button', { name: 'bank' }));
  expect(screen.getByRole('dialog', { name: 'bank' })).toBeInTheDocument();
  vi.mocked(audio.cancelSpeech).mockClear();
  await editSource();
  expect(audio.cancelSpeech).toHaveBeenCalled(); expect(screen.queryByRole('dialog', { name: 'bank' })).toBeNull();
});

test('dictation reviews before applying, preserves previous output and never translates automatically', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Прежний ответ'); await compose('Old source.'); await translate(); await screen.findByText('Прежний ответ'); await editSource();
  const transcript = deferred<string>(); vi.mocked(startDictation).mockReturnValue({ result: transcript.promise, cancel: vi.fn(), stop: vi.fn() });
  await openDisclosure('More input options'); await userEvent.click(screen.getByRole('button', { name: 'Dictate in English' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()); await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  await act(async () => transcript.resolve(sentence));
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue('Old source.');
  await userEvent.click(screen.getByRole('button', { name: 'Replace text' }));
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue(sentence);
  expect(translatePassage).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole('button', { name: 'Back to translation' }));
  expect(screen.getByText('Прежний ответ')).toBeInTheDocument();
});

test('an explicit job reads the current key even before React rerenders and is not cancelled by the following effect', async () => {
  const before = { provider: 'custom' as const, apiKey: 'old-test-key', model: 'test-only', baseUrl: 'https://old.invalid' };
  const current = { ...before, apiKey: 'current-test-key', baseUrl: 'https://current.invalid' };
  useAiStore.setState({ config: before });
  const pending = deferred<string>(); vi.mocked(translatePassage).mockReturnValue(pending.promise);
  const hook = renderHook(() => usePassageTranslation());
  act(() => { useAiStore.setState({ config: current }); void hook.result.current.start('Fresh source.', 'ai'); });
  expect(translatePassage).toHaveBeenCalledWith('Fresh source.', expect.objectContaining({ config: current }));
  expect(vi.mocked(translatePassage).mock.calls[0]?.[1].signal.aborted).toBe(false);
  await act(async () => pending.resolve('Текущий ответ'));
  expect(hook.result.current.result?.text).toBe('Текущий ответ');
});

test('resizing to desktop keeps the unfinished Russian edit visible and intact', async () => {
  const listeners = new Set<() => void>();
  const query = { matches: false, addEventListener: (_event: string, fn: () => void) => listeners.add(fn), removeEventListener: (_event: string, fn: () => void) => listeners.delete(fn) };
  vi.stubGlobal('matchMedia', vi.fn((name: string) => name.includes('min-width: 900px') ? query : { matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.mocked(translatePassage).mockResolvedValue('Перевод'); await compose(); await translate(); await screen.findByText('Перевод');
  await editTranslation();
  fireEvent.change(screen.getByLabelText('Russian translation'), { target: { value: 'Неоконченная правка' } });
  act(() => { query.matches = true; for (const listener of listeners) listener(); });
  expect(screen.getByLabelText('Russian translation')).toHaveValue('Неоконченная правка');
  act(() => { query.matches = false; for (const listener of listeners) listener(); });
  expect(screen.getByLabelText('Russian translation')).toHaveValue('Неоконченная правка');
  expect(screen.getByRole('button', { name: 'Save edit' })).toBeInTheDocument();
});

test('spent AI quota offers an explicit free choice without starting another translation', async () => {
  vi.mocked(translatePassage).mockRejectedValue(new ApiFailure('quota_exhausted', 429));
  await compose(); await selectMode('ai'); await translate();
  expect(await screen.findByRole('alert')).toHaveTextContent('The AI budget is spent');
  await userEvent.click(screen.getByRole('button', { name: 'Choose free translation' }));
  expect(screen.getByLabelText('Translation mode')).toHaveValue('free');
  expect(screen.getByRole('textbox', { name: 'English text' })).toHaveValue(sentence);
  expect(translatePassage).toHaveBeenCalledOnce();
});

test('an unavailable AI path after a cache miss explains access instead of implying a network outage', async () => {
  vi.mocked(translatePassage).mockRejectedValue(new Error('AI is not available'));
  await compose(); await selectMode('ai'); await translate();
  expect(await screen.findByRole('alert')).toHaveTextContent('New AI translation needs Pro or your key');
  expect(screen.getByRole('button', { name: 'Choose free translation' })).toBeInTheDocument();
});

test('a callback retained from the previous data owner cannot start a new-owner request', async () => {
  vi.mocked(translatePassage).mockResolvedValue('Новый ответ');
  const hook = renderHook(() => usePassageTranslation());
  const previousStart = hook.result.current.start;
  await act(async () => { invalidateDataScope(); await previousStart('Private previous text.', 'free'); });
  expect(translatePassage).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.start('New owner text.', 'free'); });
  expect(translatePassage).toHaveBeenCalledWith('New owner text.', expect.anything());
});

test('a callback retained after unmount cannot send a translation', async () => {
  const hook = renderHook(() => usePassageTranslation());
  const start = hook.result.current.start;
  hook.unmount();
  await start('Detached source.', 'free');
  expect(translatePassage).not.toHaveBeenCalled();
});

test('a key invalidated during dispatch cannot leave the job loading', async () => {
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'old-test-key', model: 'test-only', baseUrl: 'https://test.invalid' } });
  vi.mocked(translatePassage).mockImplementation(async () => {
    useAiStore.getState().forgetKey('custom');
    throw new DOMException('Changed configuration', 'AbortError');
  });
  const hook = renderHook(() => usePassageTranslation());
  await act(async () => { await hook.result.current.start('Pending source.', 'ai'); });
  expect(hook.result.current.result?.state).toBe('cancelled');
});
