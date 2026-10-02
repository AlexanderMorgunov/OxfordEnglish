import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import { VocabularyPage } from './VocabularyPage';
import * as Manage from '@/features/vocab/manage';

vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/vocab/lemma', () => ({ useLemma: () => ({ byForm: new Map(), lemmas: new Set() }), baseForm: () => null, isFormOf: (word: string, term: string) => word === term }));
vi.mock('@/features/vocab/cefr', () => ({ useCefr: () => new Map(), cefrOf: () => null }));

beforeEach(async () => {
  vi.restoreAllMocks();
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
