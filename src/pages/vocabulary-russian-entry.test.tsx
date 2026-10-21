import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { VocabularyPage } from './VocabularyPage';
import { translateRussianTerm } from '@/features/vocab/russian-entry';
import type { RussianProposal } from '@/features/vocab/russian-entry';
import type * as RussianEntry from '@/features/vocab/russian-entry';

vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/vocab/DictationInput', () => ({ DictationInput: () => <p>English dictation</p> }));
vi.mock('@/features/vocab/WordSensesInput', () => ({ WordSensesInput: () => <p>Explicit English AI senses</p> }));
vi.mock('@/features/vocab/russian-entry', async importOriginal => ({ ...await importOriginal<typeof RussianEntry>(), translateRussianTerm: vi.fn() }));
vi.mock('@/features/vocab/lemma', () => ({ useLemma: () => ({ byForm: new Map(), lemmas: new Set() }), baseForm: () => null, isFormOf: (word: string, term: string) => word === term }));
vi.mock('@/features/vocab/cefr', () => ({ useCefr: () => new Map(), cefrOf: () => null }));
beforeEach(async () => {
  vi.restoreAllMocks(); vi.mocked(translateRussianTerm).mockReset().mockResolvedValue({ russian: 'замок', english: 'lock', cached: false });
  await db.open(); await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.pending.clear(), db.translations.clear(), db.activity.clear(), db.reviewLog.clear()]);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'надёжный' } }))));
});
afterEach(() => vi.unstubAllGlobals());
async function form() {
  render(<VocabularyPage />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: /add a word or phrase/i }));
  await userEvent.click(screen.getByRole('button', { name: 'From Russian' }));
}
async function proposal() {
  await userEvent.type(screen.getByLabelText('Russian source word or phrase'), 'замок');
  await userEvent.click(screen.getByRole('button', { name: 'Translate to English' }));
  await screen.findByRole('button', { name: 'Use translation in the fields below' });
}
const term = () => screen.getByLabelText('English word or phrase');
const answer = () => screen.getByLabelText('Translation');

test('lookup and selection only edit draft, explicit Add saves English front/Russian back', async () => {
  await form(); await userEvent.type(screen.getByLabelText('Russian source word or phrase'), 'замок');
  expect(translateRussianTerm).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Translate to English' }));
  await screen.findByRole('button', { name: 'Use translation in the fields below' });
  expect(term()).toHaveValue(''); expect(answer()).toHaveValue(''); expect(await db.srsCards.count()).toBe(0);
  await userEvent.click(screen.getByRole('button', { name: 'Use translation in the fields below' }));
  await waitFor(() => expect(term()).toHaveValue('lock')); expect(answer()).toHaveValue('замок');
  await waitFor(() => expect(term()).toHaveFocus()); expect(await db.srsCards.count()).toBe(0); expect(await db.activity.count()).toBe(0);
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('word:lock'))?.back).toBe('замок'));
  expect((await db.srsCards.get('word:lock'))?.card.reps).toBe(0); expect(await db.reviewLog.count()).toBe(0);
  expect(await db.srsCards.get('word:замок')).toBeUndefined(); expect(fetch).not.toHaveBeenCalled();
});
test('manual reverse fallback supports a phrase and checks English/Russian scripts', async () => {
  await form(); fireEvent.change(term(), { target: { value: 'доброе утро' } }); fireEvent.change(answer(), { target: { value: 'доброе утро' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add' })); expect(await screen.findByRole('alert')).toHaveTextContent('English word');
  fireEvent.change(term(), { target: { value: 'Good morning' } }); fireEvent.change(answer(), { target: { value: 'Good morning' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add' })); expect(await screen.findByRole('alert')).toHaveTextContent('Russian translation');
  fireEvent.change(answer(), { target: { value: 'доброе утро' } }); await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('phrase:good morning'))?.back).toBe('доброе утро')); expect(translateRussianTerm).not.toHaveBeenCalled();
});
test('retained context needs confirmation, selection never overwrites it', async () => {
  await form(); fireEvent.change(screen.getByLabelText('Example or context'), { target: { value: 'We opened the lock.' } });
  await proposal(); await userEvent.click(screen.getByRole('button', { name: 'Use translation in the fields below' })); await waitFor(() => expect(term()).toHaveValue('lock'));
  expect(screen.getByLabelText('Example or context')).toHaveValue('We opened the lock.');
  await userEvent.click(screen.getByRole('button', { name: 'Add' })); expect(await screen.findByRole('alert')).toHaveTextContent('confirm');
  await userEvent.click(screen.getByRole('checkbox')); fireEvent.change(answer(), { target: { value: 'дверной замок' } }); expect(screen.getByRole('checkbox')).not.toBeChecked();
  await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('word:lock'))?.contextSentence).toBe('We opened the lock.'));
});
test('manual RU origin remains protected after switching English and reopening', async () => {
  await form(); fireEvent.change(term(), { target: { value: 'lock' } }); fireEvent.change(answer(), { target: { value: 'новый замок' } });
  await userEvent.click(screen.getByRole('button', { name: 'In English' }));
  await userEvent.click(screen.getByRole('button', { name: 'cancel' })); await userEvent.click(screen.getByRole('button', { name: /add a word or phrase/i }));
  const card = createEmptyCard(new Date(0)); card.reps = 7;
  await act(async () => db.srsCards.put({ id: 'word:lock', kind: 'word', front: 'lock', back: 'старый', contextGloss: 'старый смысл', tags: [], card, due: card.due }));
  const old = await db.srsCards.get('word:lock');
  await userEvent.click(screen.getByRole('button', { name: 'Add' })); expect(await screen.findByRole('alert')).toHaveTextContent('already has a card');
  expect(await db.srsCards.get('word:lock')).toEqual(old); expect(await db.translations.get('lock')).toBeUndefined(); expect(await db.activity.count()).toBe(0);
});
test('mode switch cannot bypass English-front and nonempty Russian-back checks', async () => {
  await form(); await userEvent.click(screen.getByRole('button', { name: 'In English' })); fireEvent.change(term(), { target: { value: 'лук' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add' })); expect(await screen.findByRole('alert')).toHaveTextContent('English word');
  fireEvent.change(term(), { target: { value: 'onion' } }); await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Russian translation'); expect(await db.srsCards.count()).toBe(0); expect(fetch).not.toHaveBeenCalled();
});
test('Start over cancels and clears whole draft/provenance, restoring ordinary blank-answer Add', async () => {
  await form(); fireEvent.change(term(), { target: { value: 'lock' } }); fireEvent.change(answer(), { target: { value: 'замок' } });
  fireEvent.change(screen.getByLabelText('Example or context'), { target: { value: 'Old sentence.' } });
  await userEvent.click(screen.getByRole('button', { name: 'Start over' })); expect(term()).toHaveValue(''); expect(answer()).toHaveValue('');
  expect(screen.getByLabelText('Example or context')).toHaveValue(''); expect(screen.queryByLabelText('Russian source word or phrase')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'In English' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(term(), { target: { value: 'reliable' } }); await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect((await db.srsCards.get('word:reliable'))?.back).toBe('надёжный')); expect(fetch).toHaveBeenCalledOnce();
});
test.each(['cancel', 'source', 'draft', 'mode', 'close', 'owner', 'reset', 'collapse'] as const)('late reverse result ignored after %s, double request locked', async action => {
  let finish!: (value: RussianProposal) => void; vi.mocked(translateRussianTerm).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await form(); fireEvent.change(screen.getByLabelText('Russian source word or phrase'), { target: { value: 'замок' } });
  const button = screen.getByRole('button', { name: 'Translate to English' }); fireEvent.click(button); fireEvent.click(button); expect(translateRussianTerm).toHaveBeenCalledOnce();
  const signal = vi.mocked(translateRussianTerm).mock.calls[0]?.[1];
  if (action === 'cancel') await userEvent.click(screen.getByRole('button', { name: 'Cancel translation' }));
  else if (action === 'collapse') await userEvent.click(screen.getByText('Find the English term'));
  else if (action === 'source') fireEvent.change(screen.getByLabelText('Russian source word or phrase'), { target: { value: 'дом' } });
  else if (action === 'draft') fireEvent.change(answer(), { target: { value: 'вручную' } });
  else if (action === 'mode') await userEvent.click(screen.getByRole('button', { name: 'In English' }));
  else if (action === 'close') await userEvent.click(screen.getByRole('button', { name: 'cancel' }));
  else if (action === 'reset') await userEvent.click(screen.getByRole('button', { name: 'Start over' }));
  else act(() => invalidateDataScope());
  expect(signal?.aborted).toBe(true); await act(async () => finish({ russian: 'замок', english: 'lock', cached: false }));
  expect(screen.queryByRole('button', { name: 'Use translation in the fields below' })).not.toBeInTheDocument(); expect(await db.srsCards.count()).toBe(0);
  if (action === 'draft') expect(answer()).toHaveValue('вручную');
  if (action === 'cancel') await waitFor(() => expect(button).toHaveFocus());
});
test('async duplicate precheck cannot overwrite a newly edited draft', async () => {
  await form(); await proposal(); const get = db.srsCards.get.bind(db.srsCards);
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(db.srsCards, 'get').mockImplementation((...args) => Dexie.Promise.resolve(blocked).then(() => get(...args)));
  await userEvent.click(screen.getByRole('button', { name: 'Use translation in the fields below' })); fireEvent.change(answer(), { target: { value: 'мой новый ответ' } });
  await act(async () => release()); expect(answer()).toHaveValue('мой новый ответ'); expect(term()).toHaveValue('');
});
test.each([false, true])('existing or deleted term rejects selection without changing fields (%s)', async deleted => {
  const card = createEmptyCard(new Date(0)); await db.srsCards.put({ id: 'word:lock', kind: 'word', front: 'lock', back: 'старый', tags: [], card, due: card.due, ...(deleted ? { updatedAt: 1, deletedAt: 2 } : {}) });
  await form(); fireEvent.change(term(), { target: { value: 'original' } }); fireEvent.change(answer(), { target: { value: 'вручную' } }); await proposal();
  await userEvent.click(screen.getByRole('button', { name: 'Use translation in the fields below' })); expect(await screen.findByRole('alert')).toHaveTextContent(deleted ? 'previously deleted' : 'already has a card');
  expect(term()).toHaveValue('original'); expect(answer()).toHaveValue('вручную'); expect(await db.activity.count()).toBe(0);
});
test('recoverable lookup failure keeps manual reverse Add usable', async () => {
  vi.mocked(translateRussianTerm).mockRejectedValueOnce(new Error('Provider unavailable')); await form();
  fireEvent.change(screen.getByLabelText('Russian source word or phrase'), { target: { value: 'дом' } }); await userEvent.click(screen.getByRole('button', { name: 'Translate to English' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Translation unavailable');
  fireEvent.change(term(), { target: { value: 'house' } }); fireEvent.change(answer(), { target: { value: 'дом' } });
  await userEvent.click(screen.getByRole('button', { name: 'Add' })); await waitFor(async () => expect((await db.srsCards.get('word:house'))?.back).toBe('дом'));
});

test('Enter in Russian acquisition field translates new source and never submits an older valid draft', async () => {
  await form(); fireEvent.change(term(), { target: { value: 'house' } }); fireEvent.change(answer(), { target: { value: 'дом' } });
  await userEvent.type(screen.getByLabelText('Russian source word or phrase'), 'замок{Enter}');
  await screen.findByRole('button', { name: 'Use translation in the fields below' });
  expect(translateRussianTerm).toHaveBeenCalledOnce(); expect(term()).toHaveValue('house'); expect(answer()).toHaveValue('дом'); expect(await db.srsCards.count()).toBe(0);
});


test('using a Russian proposal collapses the helper; reopening keeps the source without another lookup', async () => {
  await form(); await proposal();
  await userEvent.click(screen.getByRole('button', { name: 'Use translation in the fields below' }));
  await waitFor(() => expect(term()).toHaveFocus());
  const summary = screen.getByText('Find the English term');
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(answer()).toHaveAttribute('aria-required', 'true');
  await userEvent.click(summary);
  expect(screen.getByLabelText('Russian source word or phrase')).toHaveValue('замок');
  expect(term()).toHaveValue('lock'); expect(answer()).toHaveValue('замок');
  expect(translateRussianTerm).toHaveBeenCalledOnce();
  expect(await db.srsCards.count()).toBe(0);
});
