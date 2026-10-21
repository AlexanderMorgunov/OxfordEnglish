import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import { VocabularyPage } from './VocabularyPage';
import * as Manage from '@/features/vocab/manage';
import { probeDictation, startDictation } from '@/features/vocab/dictation';
import { requestWordSenses } from '@/features/vocab/word-senses';
import { AI_REQUEST_TIMEOUT } from '@/features/ai/route';
import { invalidateDataScope } from '@/features/account/dataScope';

vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/vocab/dictation', () => ({ probeDictation: vi.fn(), startDictation: vi.fn(), installDictation: vi.fn() }));
vi.mock('@/features/vocab/word-senses', () => ({ requestWordSenses: vi.fn() }));
vi.mock('@/features/vocab/lemma', () => ({ useLemma: () => ({ byForm: new Map(), lemmas: new Set() }), baseForm: () => null, isFormOf: (word: string, term: string) => word === term }));
vi.mock('@/features/vocab/cefr', () => ({ useCefr: () => new Map(), cefrOf: () => null }));

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(probeDictation).mockReset().mockResolvedValue({ local: 'ready', system: true, install: false, native: false });
  vi.mocked(startDictation).mockReset();
  vi.mocked(requestWordSenses).mockReset().mockResolvedValue({ path: 'managed', cached: false, senses: [
    { partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'We sat on the bank.' },
    { partOfSpeech: 'noun', translation: 'банк', distinction: 'Финансовое учреждение', example: 'I use this bank.' },
  ] });
  await db.open();
  await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.pending.clear(), db.translations.clear(), db.activity.clear()]);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'надёжный' } }))));
});

afterEach(() => vi.unstubAllGlobals());

async function fill(term = 'reliable', translation = '') {
  render(<VocabularyPage />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: /add a word or phrase/i }));
  await userEvent.type(screen.getByPlaceholderText('word or phrase (English)'), term);
  if (translation) await userEvent.type(screen.getByPlaceholderText('translation (optional)'), translation);
}

test('adding without a translation automatically fills the saved answer', async () => {
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('word:reliable'))?.back).toBe('надёжный'));
  expect(fetch).toHaveBeenCalledOnce();
  expect((await db.translations.get('reliable'))?.source).toBe('mymemory');
});

test('a supplied translation is saved directly without automatic lookup', async () => {
  await fill('reliable', 'мой перевод');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('word:reliable'))?.back).toBe('мой перевод'));
  expect(fetch).not.toHaveBeenCalled();
});

test('a refused save retains input, reports failure and never starts lookup', async () => {
  const card = createEmptyCard(new Date(0));
  await db.srsCards.put({ id: 'word:reliable', kind: 'word', front: 'reliable', back: 'reliable', tags: [], card, due: card.due, updatedAt: 1, deletedAt: 2 });
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.getByPlaceholderText('word or phrase (English)')).toHaveValue('reliable');
  expect(fetch).not.toHaveBeenCalled();
});

test('Enter saves offline and a failed lookup leaves the new word available', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Offline'); }));
  await fill();
  await userEvent.keyboard('{Enter}');
  await screen.findByText(/Translation unavailable/);
  expect((await db.srsCards.get('word:reliable'))?.back).toBe('reliable');
  expect(screen.queryByPlaceholderText('word or phrase (English)')).not.toBeInTheDocument();
});

test('a final transaction failure retains the draft and permits retry', async () => {
  const write = vi.spyOn(db.translations, 'put').mockRejectedValueOnce(new Error('Storage failure'));
  await fill('reliable', 'мой перевод');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(screen.getByPlaceholderText('translation (optional)')).toHaveValue('мой перевод');
  write.mockRestore();
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(screen.queryByPlaceholderText('word or phrase (English)')).not.toBeInTheDocument());
  expect((await db.translations.get('reliable'))?.source).toBe('manual');
  expect(fetch).not.toHaveBeenCalled();
});

test('a saved word is announced even when the current search hides its row', async () => {
  await fill('reliable', 'мой перевод');
  await userEvent.type(screen.getByRole('searchbox'), 'unrelated');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByText('Saved in vocabulary: “reliable”.')).toHaveAttribute('role', 'status');
  expect(screen.getByRole('searchbox')).toHaveValue('unrelated');
  expect(screen.queryByRole('button', { name: 'Edit translation' })).not.toBeInTheDocument();
});

test('two immediate submissions start only one save and lookup', async () => {
  const save = vi.spyOn(Manage, 'addTerm');
  await fill();
  const form = screen.getByRole('button', { name: 'Add' }).closest('form');
  if (!form) throw new Error('Missing add form');
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(save).toHaveBeenCalledOnce();
  await waitFor(async () => expect((await db.srsCards.get('word:reliable'))?.back).toBe('надёжный'));
  expect(fetch).toHaveBeenCalledOnce();
});

test('dictated phrase is editable input only; explicit Add alone persists it and starts automatic translation', async () => {
  await fill('Old phrase'); let finish!: (value: string) => void;
  vi.mocked(startDictation).mockReturnValue({ result: new Promise(resolve => { finish = resolve; }), cancel: vi.fn(), stop: vi.fn() });
  await userEvent.click(screen.getByRole('button', { name: 'Dictate in English' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()); await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  await act(async () => finish('Take care')); expect(screen.getByLabelText('English word or phrase')).toHaveValue('Old phrase');
  expect(await db.srsCards.count()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Replace text' }));
  expect(screen.getByLabelText('English word or phrase')).toHaveValue('Take care'); expect(await db.srsCards.count()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('phrase:take care'))?.back).toBe('надёжный')); expect(fetch).toHaveBeenCalledOnce();
});

test.each(['term','translation','context','submit'])('%s edit or submit invalidates the manual-form microphone and late transcript', async target => {
  await fill('reliable','мой перевод'); let finish!: (value: string) => void; const cancel = vi.fn();
  vi.mocked(startDictation).mockReturnValue({ result: new Promise(resolve => { finish = resolve; }), cancel, stop: vi.fn() });
  await userEvent.click(screen.getByRole('button', { name: 'Dictate in English' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()); await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  if(target==='submit') await userEvent.click(screen.getByRole('button',{name:'Add'}));
  else fireEvent.change(screen.getByLabelText(target==='term'?'English word or phrase':target==='translation'?'Translation':'Example or context'),{target:{value:'Edited'}});
  expect(cancel).toHaveBeenCalled(); await act(async()=>finish('Late phrase')); expect(screen.queryByLabelText('Check dictated text')).toBeNull();
  expect(await db.srsCards.get('phrase:late phrase')).toBeUndefined(); expect(fetch).not.toHaveBeenCalled();
  if (target === 'submit') await waitFor(() => expect(screen.queryByLabelText('English word or phrase')).toBeNull());
});

test('AI meanings require an explicit request and selection is only an editable draft', async () => {
  await fill('bank');
  expect(requestWordSenses).not.toHaveBeenCalled();
  expect(screen.getByText('AI meanings').closest('details')).not.toHaveAttribute('open');
  await userEvent.click(screen.getByText('AI meanings'));
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Choose meaning 1' }));
  await waitFor(() => expect(screen.getByLabelText('Translation')).toHaveValue('берег'));
  expect(screen.getByLabelText('Translation')).toHaveAttribute('aria-required', 'true');
  expect(screen.getByLabelText('Translation')).toHaveAttribute('placeholder', 'Russian translation (required)');
  await waitFor(() => expect(screen.getByLabelText('Translation')).toHaveFocus());
  expect(screen.getByText('AI meanings').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByLabelText('Example or context')).toHaveValue('We sat on the bank.');
  expect(await db.srsCards.count()).toBe(0); expect(await db.activity.count()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('word:bank'))?.back).toBe('берег'));
  expect((await db.srsCards.get('word:bank'))?.contextSentence).toBe('We sat on the bank.');
  expect((await db.srsCards.get('word:bank'))?.partOfSpeech).toBe('noun');
  expect(requestWordSenses).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});
test('custom context needs an explicit keep/use choice; later edits need agreement again', async () => {
  await fill('bank', 'мой перевод');
  await userEvent.type(screen.getByLabelText('Example or context'), 'We walked by the bank.');
  await userEvent.click(screen.getByText('AI meanings'));
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Choose meaning 1' }));
  const choice = screen.getByRole('group', { name: 'Example choice' });
  expect(choice.closest('li')).toContainElement(screen.getByRole('button', { name: 'Choose meaning 1' }));
  expect(within(choice).getByRole('button', { name: 'Use this example' })).toHaveFocus();
  expect(screen.getByLabelText('Translation')).toHaveValue('мой перевод');
  await userEvent.click(screen.getByRole('button', { name: 'My example matches' }));
  await waitFor(() => expect(screen.getByLabelText('Translation')).toHaveValue('берег'));
  expect(screen.getByLabelText('Example or context')).toHaveValue('We walked by the bank.');
  fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'берег реки' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('confirm');
  expect(screen.getByRole('checkbox', { name: 'My example matches the chosen meaning' })).toHaveFocus();
  expect(await db.srsCards.count()).toBe(0);
  await userEvent.click(screen.getByRole('checkbox', { name: 'My example matches the chosen meaning' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('word:bank'))?.back).toBe('берег реки'));
});
test('an existing word rejects sense selection before changing either draft field', async () => {
  const card = createEmptyCard(new Date(0));
  await db.srsCards.put({ id: 'word:bank', kind: 'word', front: 'bank', back: 'банк', contextGloss: 'старый смысл', tags: [], card, due: card.due });
  await fill('bank', 'мой перевод');
  await userEvent.click(screen.getByText('AI meanings'));
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Choose meaning 1' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already has a card');
  expect(screen.getByLabelText('Translation')).toHaveValue('мой перевод');
  expect((await db.srsCards.get('word:bank'))?.contextGloss).toBe('старый смысл');
});
test('editing an AI-derived draft cannot bypass atomic concurrent-duplicate protection', async () => {
  await fill('bank');
  await userEvent.click(screen.getByText('AI meanings'));
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Choose meaning 1' }));
  await waitFor(() => expect(screen.getByLabelText('Translation')).toHaveValue('берег'));
  const card = createEmptyCard(new Date(0));
  await act(async () => db.srsCards.put({ id: 'word:bank', kind: 'word', front: 'bank', back: 'банк', tags: [], card, due: card.due, contextGloss: 'старый смысл' }));
  const before = await db.srsCards.get('word:bank');
  fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'новый берег' } });
  await userEvent.click(screen.getByRole('checkbox', { name: 'My example matches the chosen meaning' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already has a card');
  expect(await db.srsCards.get('word:bank')).toEqual(before);
  expect(await db.translations.get('bank')).toBeUndefined();
  expect(await db.activity.count()).toBe(0);
});
test.each(['term', 'cancel', 'owner', 'close'] as const)('late AI proposals cannot affect draft after %s invalidation', async action => {
  let finish!: (value: Awaited<ReturnType<typeof requestWordSenses>>) => void;
  vi.mocked(requestWordSenses).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await fill('bank', 'мой перевод');
  await userEvent.click(screen.getByText('AI meanings'));
  const button = screen.getByRole('button', { name: 'Meanings and examples · AI' });
  fireEvent.click(button); fireEvent.click(button);
  expect(requestWordSenses).toHaveBeenCalledOnce();
  const requestSignal = vi.mocked(requestWordSenses).mock.calls[0]?.[2];
  if (action === 'term') fireEvent.change(screen.getByLabelText('English word or phrase'), { target: { value: 'river' } });
  else if (action === 'cancel') await userEvent.click(screen.getByRole('button', { name: 'Cancel request' }));
  else if (action === 'owner') act(() => invalidateDataScope());
  else await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
  expect(requestSignal?.aborted).toBe(true);
  await act(async () => finish({ path: 'managed', cached: false, senses: [{ partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'The bank.' }] }));
  expect(screen.queryByRole('button', { name: 'Choose meaning 1' })).not.toBeInTheDocument();
  expect(await db.srsCards.count()).toBe(0);
  if (action === 'term' || action === 'cancel') expect(screen.getByLabelText('Translation')).toHaveValue('мой перевод');
});
test('typing a manual answer while waiting is preserved when suggestions arrive', async () => {
  let finish!: (value: Awaited<ReturnType<typeof requestWordSenses>>) => void;
  vi.mocked(requestWordSenses).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await fill('bank');
  await userEvent.click(screen.getByText('AI meanings'));
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  await userEvent.type(screen.getByLabelText('Translation'), 'вручную');
  await act(async () => finish({ path: 'managed', cached: true, senses: [] }));
  expect(screen.getByLabelText('Translation')).toHaveValue('вручную');
  expect(screen.getByLabelText('Translation')).toHaveFocus();
  expect(screen.getByText('No reliable suggestions. Enter a translation or use ordinary translation.')).toBeVisible();
});

test('editing the draft during an asynchronous sense selection preserves the new answer and context', async () => {
  await fill('bank', 'вручную');
  await userEvent.type(screen.getByLabelText('Example or context'), 'Original context.');
  await userEvent.click(screen.getByText('AI meanings'));
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Choose meaning 1' }));
  const get = db.srsCards.get.bind(db.srsCards);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(db.srsCards, 'get').mockImplementation((...args) => Dexie.Promise.resolve(blocked).then(() => get(...args)));
  await userEvent.click(screen.getByRole('button', { name: 'My example matches' }));
  fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'новый ручной ответ' } });
  fireEvent.change(screen.getByLabelText('Example or context'), { target: { value: 'Different context.' } });
  await act(async () => release());
  expect(await screen.findByText('The draft changed. Choose the meaning again.')).toBeVisible();
  expect(screen.getByLabelText('Translation')).toHaveValue('новый ручной ответ');
  expect(screen.getByLabelText('Example or context')).toHaveValue('Different context.');
  expect(await db.srsCards.count()).toBe(0);
});


test('closing and reopening AI tools does not request meanings; collapse cancels pending work', async () => {
  let finish!: (value: Awaited<ReturnType<typeof requestWordSenses>>) => void;
  vi.mocked(requestWordSenses).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await fill('bank');
  const summary = screen.getByText('AI meanings');
  await userEvent.click(summary);
  expect(requestWordSenses).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  const signal = vi.mocked(requestWordSenses).mock.calls[0]![2];
  await userEvent.click(summary);
  expect(signal.aborted).toBe(true);
  await userEvent.click(summary);
  await act(async () => finish({ path: 'managed', cached: false, senses: [{ partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'The bank.' }] }));
  expect(requestWordSenses).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Choose meaning 1' })).toBeNull();
  expect(screen.getByLabelText('Translation')).toHaveValue('');
});

test('an AI draft requires a translation and focuses the field when it is cleared', async () => {
  await fill('bank');
  await userEvent.click(screen.getByText('AI meanings'));
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Choose meaning 1' }));
  const answer = screen.getByLabelText('Translation');
  await waitFor(() => expect(answer).toHaveValue('берег'));
  fireEvent.change(answer, { target: { value: '' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Check the translation');
  expect(answer).toHaveAttribute('aria-required', 'true');
  expect(answer).toHaveAttribute('aria-invalid', 'true');
  expect(answer).toHaveFocus();
  expect(await db.srsCards.count()).toBe(0);
});

test('cancel keeps the draft and restores the opener; saving restores it again', async () => {
  await fill('bank', 'берег');
  await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
  const opener = screen.getByRole('button', { name: /add a word or phrase/i });
  await waitFor(() => expect(opener).toHaveFocus());
  await userEvent.click(opener);
  expect(screen.getByLabelText('Translation')).toHaveValue('берег');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /add a word or phrase/i })).toHaveFocus());
  expect(fetch).not.toHaveBeenCalled();
});

test('collapsing a sense panel during duplicate precheck cannot replace the draft', async () => {
  await fill('bank', 'вручную');
  await userEvent.click(screen.getByText('AI meanings'));
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  await screen.findByRole('button', { name: 'Choose meaning 1' });
  const get = db.srsCards.get.bind(db.srsCards);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(db.srsCards, 'get').mockImplementation((...args) => Dexie.Promise.resolve(blocked).then(() => get(...args)));
  await userEvent.click(screen.getByRole('button', { name: 'Choose meaning 1' }));
  await userEvent.click(screen.getByText('AI meanings'));
  await act(async () => release());
  expect(screen.getByLabelText('Translation')).toHaveValue('вручную');
  expect(screen.getByLabelText('Example or context')).toHaveValue('');
  expect(await db.srsCards.count()).toBe(0);
});


test.each([false, true])('AI timeout restores request focus unless the user moved to a draft field (%s)', async moved => {
  vi.mocked(requestWordSenses).mockImplementationOnce(() => new Promise(() => {}));
  await fill('bank');
  await userEvent.click(screen.getByText('AI meanings'));
  const timers = vi.spyOn(globalThis, 'setTimeout');
  await userEvent.click(screen.getByRole('button', { name: 'Meanings and examples · AI' }));
  expect(screen.getByRole('button', { name: 'Cancel request' })).toHaveFocus();
  if (moved) await userEvent.type(screen.getByLabelText('Translation'), 'вручную');
  const callback = timers.mock.calls.find(([, delay]) => delay === AI_REQUEST_TIMEOUT + 2000)?.[0];
  if (typeof callback !== 'function') throw new Error('No request deadline');
  act(() => callback());
  expect(await screen.findByRole('alert')).toHaveTextContent('timed out');
  expect(moved ? screen.getByLabelText('Translation') : screen.getByRole('button', { name: 'Meanings and examples · AI' })).toHaveFocus();
});
