import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { VocabularyPage } from './VocabularyPage';
import { addTerm } from '@/features/vocab/manage';
import * as Manage from '@/features/vocab/manage';
import { invalidateDataScope } from '@/features/account/dataScope';

vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('@/features/vocab/lemma', () => ({ useLemma: () => ({ byForm: new Map(), lemmas: new Set() }), baseForm: () => null, isFormOf: (word: string, term: string) => word === term }));
vi.mock('@/features/vocab/cefr', () => ({ useCefr: () => new Map(), cefrOf: () => null }));

beforeEach(async () => {
  invalidateDataScope();
  await db.open();
  await Promise.all([db.srsCards, db.wordStatus, db.translations, db.pending, db.activity].map(table => table.clear()));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ responseData: { translatedText: 'надёжный' } }))));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function draft(answer = '') {
  const view = render(<VocabularyPage />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: /add a word or phrase/i }));
  fireEvent.change(screen.getByLabelText('English word or phrase'), { target: { value: 'reliable' } });
  if (answer) fireEvent.change(screen.getByLabelText('Translation'), { target: { value: answer } });
  return view;
}

test('ordinary English draft has a free translation action before Add and never saves a proposal implicitly', async () => {
  await draft();
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  await screen.findByDisplayValue('надёжный');
  expect(await db.srsCards.count()).toBe(0);
  await userEvent.click(screen.getByRole('button', { name: 'Use translation' }));
  expect(screen.getByLabelText('Translation')).toHaveValue('надёжный');
  await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(async () => expect(await db.srsCards.get('word:reliable')).toMatchObject({ back: 'надёжный' }));
});

test('lookup preserves an existing manual draft until editable proposal is explicitly used', async () => {
  await draft('ручной перевод');
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  const proposal = await screen.findByLabelText('Suggested translation');
  expect(screen.getByLabelText('Translation')).toHaveValue('ручной перевод');
  fireEvent.change(proposal, { target: { value: 'уточнение' } });
  await userEvent.click(screen.getByRole('button', { name: 'Use translation' }));
  expect(screen.getByLabelText('Translation')).toHaveValue('уточнение');
  expect(await db.srsCards.count()).toBe(0);
});

test('Enter in the proposal applies to the draft instead of submitting Add with an old answer', async () => {
  await draft('ручной перевод');
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  const proposal = await screen.findByLabelText('Suggested translation');
  act(() => proposal.focus());
  await userEvent.keyboard('{Enter}');
  expect(screen.getByLabelText('Translation')).toHaveValue('надёжный');
  expect(await db.srsCards.count()).toBe(0);
});

test.each(['term', 'answer', 'cancel', 'owner', 'unmount'])('%s invalidates a pending draft translation', async action => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = await draft('ручной перевод');
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
  if (action === 'term') fireEvent.change(screen.getByLabelText('English word or phrase'), { target: { value: 'different' } });
  if (action === 'answer') fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'new manual answer' } });
  if (action === 'cancel') await userEvent.click(screen.getByRole('button', { name: 'Cancel lookup' }));
  if (action === 'owner') act(() => invalidateDataScope());
  if (action === 'unmount') view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(new Response(JSON.stringify({ responseData: { translatedText: 'поздний перевод' } }))));
  expect(screen.queryByLabelText('Suggested translation')).toBeNull();
  expect(await db.srsCards.count()).toBe(0);
});

test('existing answered entry has a discoverable lookup and proposal cannot overwrite its card or manual cache', async () => {
  await addTerm('reliable', 'ручной перевод', 'A reliable source.');
  const original = await db.srsCards.get('word:reliable');
  render(<VocabularyPage />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Edit / translate reliable' }));
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  await screen.findByDisplayValue('надёжный');
  expect(await db.srsCards.get('word:reliable')).toEqual(original);
  expect(await db.translations.get('reliable')).toMatchObject({ ru: 'ручной перевод', source: 'manual' });
  await userEvent.click(screen.getByRole('button', { name: 'Use translation' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save translation' }));
  await waitFor(async () => expect(await db.srsCards.get('word:reliable')).toMatchObject({ back: 'надёжный' }));
  expect((await db.srsCards.get('word:reliable'))?.card).toEqual(original?.card);
});

test('lookup failure retains the manual answer and offers retry without saving', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('synthetic unavailable'));
  await draft('ручной перевод');
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Translation unavailable');
  expect(screen.getByLabelText('Translation')).toHaveValue('ручной перевод');
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  await screen.findByDisplayValue('надёжный');
  expect(await db.srsCards.count()).toBe(0);
});

test('a stalled proposal has a deadline and its late completion cannot replace retry', async () => {
  let finish!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await draft('ручной перевод');
  const timers = vi.spyOn(globalThis, 'setTimeout');
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const deadline = timers.mock.calls.find(([, duration]) => duration === 8000)?.[0];
  if (typeof deadline !== 'function') throw new Error('Missing lookup deadline');
  act(() => deadline());
  expect(await screen.findByRole('alert')).toHaveTextContent('Translation unavailable');
  await userEvent.click(screen.getByRole('button', { name: 'Translate · free' }));
  await screen.findByDisplayValue('надёжный');
  await act(async () => finish(new Response(JSON.stringify({ responseData: { translatedText: 'поздний перевод' } }))));
  expect(screen.getByLabelText('Suggested translation')).toHaveValue('надёжный');
  expect(screen.getByLabelText('Translation')).toHaveValue('ручной перевод');
});

test('late save for another row preserves the active editor and its newer draft', async () => {
  await addTerm('Alpha', 'альфа', 'Alpha.');
  await addTerm('beta', 'бета', 'beta.');
  const original = Manage.setTranslation;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(Manage, 'setTranslation').mockImplementation((entry, translation) => blocked.then(() => original(entry, translation)));
  render(<VocabularyPage />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Edit / translate Alpha' }));
  fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'новая альфа' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save translation' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit / translate beta' }));
  fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'новый черновик бета' } });
  await act(async () => { release(); await vi.mocked(Manage.setTranslation).mock.results[0]?.value; });
  expect(screen.getByLabelText('Translation')).toHaveValue('новый черновик бета');
  expect(screen.getByRole('button', { name: 'Edit / translate beta' })).toHaveAttribute('aria-expanded', 'true');
  expect(await db.srsCards.get('word:alpha')).toMatchObject({ back: 'новая альфа' });
  expect(await db.srsCards.get('word:beta')).toMatchObject({ back: 'бета' });
});

test('repeated Save during the same row operation starts one write and no false failure', async () => {
  await addTerm('Alpha', 'альфа', 'Alpha.');
  const original = Manage.setTranslation;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(Manage, 'setTranslation').mockImplementation((entry, translation) => blocked.then(() => original(entry, translation)));
  render(<VocabularyPage />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Edit / translate Alpha' }));
  fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'новая альфа' } });
  const save = screen.getByRole('button', { name: 'Save translation' });
  fireEvent.click(save); fireEvent.click(save);
  expect(Manage.setTranslation).toHaveBeenCalledOnce();
  await act(async () => { release(); await vi.mocked(Manage.setTranslation).mock.results[0]?.value; });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(await db.srsCards.get('word:alpha')).toMatchObject({ back: 'новая альфа' });
});
