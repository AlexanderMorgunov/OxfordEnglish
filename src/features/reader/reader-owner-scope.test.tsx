import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAiStore } from '@/features/ai/store';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { ReadingText } from './reading-text';

const contextLookup = vi.hoisted(() => vi.fn());
vi.mock('@/features/ai/functions', async original => ({ ...(await original<object>()), wordInContext: contextLookup }));
vi.mock('@/features/ai/route', async original => ({ ...(await original<object>()), useAiEnabled: () => true, useAiUnknown: () => false }));
vi.mock('@/features/vocab/translate', async original => ({ ...(await original<object>()), translateWord: async () => 'обычный перевод' }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('./difficulty', async original => ({ ...(await original<object>()), loadFreq: async () => null }));
vi.mock('@/features/vocab/lemma', async original => ({ ...(await original<object>()), useLemma: () => ({ byForm: new Map(), lemmas: new Set() }) }));
vi.mock('@/features/vocab/cefr', async original => ({ ...(await original<object>()), useCefr: () => new Map() }));

beforeEach(async () => {
  await db.open();
  await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.translations.clear(), db.pending.clear(), db.activity.clear()]);
  useVocabStore.setState({ statuses: new Map(), ready: false });
  useAiStore.setState({ config: null });
  contextLookup.mockReset();
});
afterEach(() => vi.restoreAllMocks());

test('completed contextual meaning from a previous owner closes and cannot become the new owner saved answer', async () => {
  contextLookup.mockResolvedValueOnce('контекст первого владельца').mockResolvedValueOnce('контекст нового владельца');
  render(<ReadingText paragraphs={['A quiet garden.']} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'quiet' }));
  expect(await screen.findByText('контекст первого владельца')).toBeInTheDocument();
  await act(async () => { invalidateDataScope(); await db.srsCards.clear(); await db.wordStatus.clear(); });
  expect(screen.queryByRole('dialog', { name: 'quiet' })).toBeNull();
  expect(screen.queryByText('контекст первого владельца')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'quiet' }));
  await screen.findByText('контекст нового владельца');
  await userEvent.click(within(screen.getByRole('dialog', { name: 'quiet' })).getByRole('button', { name: 'learning' }));
  await waitFor(async () => expect(await db.srsCards.get('word:quiet')).toMatchObject({ contextGloss: 'контекст нового владельца' }));
  expect((await db.srsCards.get('word:quiet'))?.contextGloss).not.toBe('контекст первого владельца');
});

test('late contextual lookup from a previous owner cannot reopen a popup or repair a new owner card', async () => {
  let resolve!: (value: string) => void;
  contextLookup.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; })).mockResolvedValueOnce('новый контекст');
  render(<ReadingText paragraphs={['A quiet garden.']} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'quiet' }));
  await waitFor(() => expect(contextLookup).toHaveBeenCalledOnce());
  await act(async () => invalidateDataScope());
  await userEvent.click(screen.getByRole('button', { name: 'quiet' }));
  await screen.findByText('новый контекст');
  await userEvent.click(within(screen.getByRole('dialog', { name: 'quiet' })).getByRole('button', { name: 'learning' }));
  await waitFor(async () => expect(await db.srsCards.get('word:quiet')).toMatchObject({ contextGloss: 'новый контекст' }));
  await act(async () => { resolve('старый контекст'); });
  expect(screen.queryByText('старый контекст')).toBeNull();
  expect((await db.srsCards.get('word:quiet'))?.contextGloss).toBe('новый контекст');
});
