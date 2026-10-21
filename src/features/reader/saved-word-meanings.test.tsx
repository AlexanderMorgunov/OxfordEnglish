import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import type { SrsCard } from '@/db/db';
import { useAiStore } from '@/features/ai/store';
import { ReadingText } from './reading-text';
import { savedWordMeaning } from './saved-word-meanings';

const lookup = vi.hoisted(() => vi.fn<() => Promise<string | null>>(async () => null));
vi.mock('@/features/vocab/translate', () => ({ translateWord: lookup }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('./difficulty', async original => ({ ...(await original<object>()), loadFreq: async () => null }));
vi.mock('@/features/vocab/lemma', async original => ({ ...(await original<object>()), useLemma: () => ({ byForm: new Map(), lemmas: new Set() }) }));
vi.mock('@/features/vocab/cefr', async original => ({ ...(await original<object>()), useCefr: () => new Map() }));

const card = (patch: Partial<SrsCard> = {}): SrsCard => ({ id: 'word:quiet', kind: 'word', front: 'quiet', back: 'спокойный', tags: [], due: new Date(), card: createEmptyCard(), ...patch });
beforeEach(async () => {
  await db.open();
  await db.srsCards.clear();
  useAiStore.setState({ config: null });
  lookup.mockReset().mockResolvedValue(null);
});

test('an exact source sentence uses its saved contextual meaning, otherwise the general answer', () => {
  const saved = card({ contextSentence: 'A quiet garden.', contextGloss: 'тихий' });
  expect(savedWordMeaning(saved, ' A  quiet garden. ')).toBe('тихий');
  expect(savedWordMeaning(saved, 'A quiet person.')).toBe('спокойный');
});

test.each([{ deletedAt: 1 }, { fromError: true }, { kind: 'phrase' as const }, { kind: 'grammar-pattern' as const }, { back: 'quiet' }, { back: ' ' }])('unsuitable saved row is not a dictionary answer: %j', patch => {
  expect(savedWordMeaning(card(patch), 'A quiet garden.')).toBeUndefined();
});

test('a saved word is readable offline with no translation-cache or provider dependency and reacts to edits', async () => {
  await db.srsCards.put(card());
  await db.translations.clear();
  render(<ReadingText paragraphs={['A quiet garden.']} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'quiet' }));
  expect(await screen.findByText('спокойный')).toBeInTheDocument();
  expect(screen.getByText('From your vocabulary')).toBeInTheDocument();
  expect(lookup).not.toHaveBeenCalled();
  await act(async () => { await db.srsCards.update('word:quiet', { back: 'тихий' }); });
  expect(await screen.findByText('тихий')).toBeInTheDocument();
  expect(screen.queryByText('спокойный')).not.toBeInTheDocument();
  await act(async () => { await db.srsCards.update('word:quiet', { deletedAt: 1 }); });
  await waitFor(() => expect(screen.queryByText('тихий')).not.toBeInTheDocument());
});

test('a late automatic lookup cannot replace a newly saved answer', async () => {
  let resolve: (value: string) => void = () => {};
  lookup.mockImplementation(() => new Promise(r => { resolve = r; }));
  render(<ReadingText paragraphs={['A quiet garden.']} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'quiet' }));
  await waitFor(() => expect(lookup).toHaveBeenCalledOnce());
  await act(async () => { await db.srsCards.put(card()); });
  expect(await screen.findByText('спокойный')).toBeInTheDocument();
  await act(async () => { resolve('старый ответ'); });
  expect(screen.getByText('спокойный')).toBeInTheDocument();
  expect(screen.queryByText('старый ответ')).not.toBeInTheDocument();
});
