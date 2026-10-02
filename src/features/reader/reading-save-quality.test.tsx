import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { useAiStore } from '@/features/ai/store';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { invalidateDataScope } from '@/features/account/dataScope';
import { addWordCard } from '@/features/srs/service';
import * as srsService from '@/features/srs/service';
import * as aiFunctions from '@/features/ai/functions';
import { addTerm, editCardAnswer } from '@/features/vocab/manage';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { ReadingText, WordToken } from './reading-text';
import { useReaderSettings } from './settings';
import { useSavedPhrases } from './saved-phrases';
import { usePhraseSelect } from './phrase-select';
import * as readerTranslate from './translate';

const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock('@/features/ai/provider', async (original) => ({
  ...(await original<object>()),
  complete: mocks.complete,
}));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const wordSentence = 'These sources are reliable.';
const phraseSentence = 'I had a sneaking suspicion.';
const phraseId = 'phrase:sneaking suspicion';

beforeEach(async () => {
  invalidateDataScope();
  mocks.complete.mockReset();
  useAccount.setState({ status: 'anonymous', accountId: null, accessToken: null });
  useEntitlement.setState({ entitlement: null });
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'test-only-key', model: 'test-only-model', baseUrl: 'https://test.invalid' } });
  useReaderSettings.setState({ aiTranslation: true, coloring: false });
  useVocabStore.setState({ statuses: new Map(), ready: false });
  useSavedPhrases.setState({ phrases: new Set(), ready: true });
  usePhraseSelect.getState().clear();
  for (const key of Object.keys(localStorage)) if (key.startsWith('ai:')) localStorage.removeItem(key);
  await db.open();
  await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.pending.clear(), db.activity.clear(), db.reviewLog.clear(), db.translations.clear()]);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/reader/en-lemma.json')) return new Response(JSON.stringify({ map: {} }));
    if (url.endsWith('/reader/en-cefr.json')) return new Response(JSON.stringify({ levels: [] }));
    if (url.endsWith('/reader/en-freq.json')) return new Response(JSON.stringify({ words: [] }));
    throw new Error(`Unexpected network request: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startWordLookup() {
  const pending = deferred<string>();
  const completion = vi.spyOn(aiFunctions, 'wordInContext');
  mocks.complete.mockReturnValueOnce(pending.promise);
  render(<WordToken word="sources" gloss={{ ru: 'источники' }} sentence={wordSentence} enableContextFetch />);
  await userEvent.click(screen.getByRole('button', { name: 'sources' }));
  await waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
  return { ...pending, finish: () => {
    const result = completion.mock.results[0];
    if (!result) throw new Error('Missing context request');
    return result.value.catch(() => undefined);
  } };
}

async function saveWord() {
  await userEvent.click(within(screen.getByRole('dialog', { name: 'sources' })).getByRole('button', { name: 'learning' }));
  await waitFor(async () => expect(await db.srsCards.get('word:sources')).toBeDefined());
  return (await db.srsCards.get('word:sources'))!;
}

async function startPhraseLookup(text = phraseSentence) {
  const pending = deferred<string>();
  const completion = vi.spyOn(readerTranslate, 'translateReaderResult');
  mocks.complete.mockReturnValueOnce(pending.promise);
  render(<ReadingText paragraphs={[text]} glossary={new Map([['sneaking', { ru: 'крадущийся' }], ['suspicion', { ru: 'подозрение' }], ['clear', { ru: 'ясный' }], ['evidence', { ru: 'доказательство' }]])} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'sneaking' }));
  await userEvent.click(screen.getByRole('button', { name: 'select phrase →' }));
  await userEvent.click(screen.getByRole('button', { name: 'suspicion' }));
  await waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
  return { ...pending, finish: () => {
    const result = completion.mock.results[0];
    if (!result) throw new Error('Missing phrase request');
    return result.value;
  } };
}

async function savePhrase() {
  await userEvent.click(screen.getByRole('button', { name: '+ save' }));
  await screen.findByRole('button', { name: '✓ saved' });
  return (await db.srsCards.get(phraseId))!;
}

test('a saved word receives its late context after closing the actual popover without resetting its schedule', async () => {
  const pending = await startWordLookup();
  const saved = await saveWord();
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  await act(async () => { pending.resolve('источники\nЕщё: происхождение'); });
  await waitFor(async () => expect((await db.srsCards.get(saved.id))?.contextGloss).toBe('источники'));
  const repaired = (await db.srsCards.get(saved.id))!;
  expect(repaired.card).toEqual(saved.card);
  expect(repaired.contextSentence).toBe(wordSentence);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect((await db.activity.toArray()).reduce((sum, row) => sum + row.wordsSaved, 0)).toBe(1);
});

test('a refused word save cannot be resurrected by its late context', async () => {
  const pending = await startWordLookup();
  await addWordCard('sources', 'источники', wordSentence);
  await db.srsCards.update('word:sources', { updatedAt: 1, deletedAt: 2 });
  await userEvent.click(screen.getByRole('button', { name: 'learning' }));
  await act(async () => { pending.resolve('старое значение'); });
  await waitFor(() => expect(screen.getByText('старое значение')).toBeInTheDocument());
  expect(await db.srsCards.get('word:sources')).toMatchObject({ updatedAt: 1, deletedAt: 2 });
  expect((await db.srsCards.get('word:sources'))?.contextGloss).toBeUndefined();
});

test.each(['manual', 'context', 'owner'] as const)('late word context preserves a %s change after a real save', async (change) => {
  const repair = vi.spyOn(srsService, 'repairCardContext');
  const pending = await startWordLookup();
  const saved = await saveWord();
  if (change === 'manual') await editCardAnswer(saved, 'ручное исправление', '');
  if (change === 'context') await addTerm('sources', '', 'The sources of this river.');
  if (change === 'owner') {
    invalidateDataScope();
    await db.srsCards.clear();
    await addWordCard('sources', 'новый владелец', 'A new sentence.');
  }
  const expected = await db.srsCards.get(saved.id);
  const cached = await db.translations.toArray();
  await act(async () => { pending.resolve('старое значение'); await pending.finish(); });
  if (change !== 'owner') {
    await waitFor(() => expect(repair).toHaveBeenCalledOnce());
    await repair.mock.results[0]?.value;
  } else {
    await screen.findByText('unavailable');
    expect(repair).not.toHaveBeenCalled();
    expect(await db.translations.toArray()).toEqual(cached);
    expect(Object.keys(localStorage).filter((key) => key.startsWith('ai:'))).toEqual([]);
  }
  expect(await db.srsCards.get(saved.id)).toEqual(expected);
});

test('a phrase saved while translating receives both late answers even after dismissing the selection', async () => {
  const pending = await startPhraseLookup();
  const saved = await savePhrase();
  expect(saved.back).toBe('sneaking suspicion');
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  await act(async () => { pending.resolve('смутное подозрение'); });
  await waitFor(async () => expect(await db.srsCards.get(phraseId)).toMatchObject({ back: 'смутное подозрение', contextGloss: 'смутное подозрение' }));
  expect((await db.srsCards.get(phraseId))?.card).toEqual(saved.card);
  expect(screen.queryByRole('button', { name: '✓ saved' })).toBeNull();
  expect((await db.activity.toArray()).reduce((sum, row) => sum + row.phrasesSaved, 0)).toBe(1);
});

test('a refused phrase save reports failure and its late answer cannot fill the deleted card', async () => {
  const pending = await startPhraseLookup();
  await addTerm('sneaking suspicion', '', phraseSentence);
  await db.srsCards.update(phraseId, { updatedAt: 1, deletedAt: 2 });
  await userEvent.click(screen.getByRole('button', { name: '+ save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  await act(async () => { pending.resolve('смутное подозрение'); });
  await screen.findByText('— смутное подозрение');
  expect(await db.srsCards.get(phraseId)).toMatchObject({ back: 'sneaking suspicion', updatedAt: 1, deletedAt: 2 });
  expect((await db.srsCards.get(phraseId))?.contextGloss).toBeUndefined();
  expect(useSavedPhrases.getState().has('sneaking suspicion')).toBe(false);
});

test.each(['manual', 'context', 'owner'] as const)('late phrase completion preserves a %s change after a real save', async (change) => {
  const repair = vi.spyOn(srsService, 'repairSavedPhrase');
  const pending = await startPhraseLookup();
  const saved = await savePhrase();
  if (change === 'manual') await editCardAnswer(saved, 'ручное исправление', '');
  if (change === 'context') await addTerm('sneaking suspicion', '', 'Another sneaking suspicion.');
  if (change === 'owner') {
    invalidateDataScope();
    await db.srsCards.clear();
    await addTerm('sneaking suspicion', 'новый владелец', 'A new sentence.');
  }
  const expected = await db.srsCards.get(saved.id);
  const cached = await db.translations.toArray();
  await act(async () => { pending.resolve('старое значение'); await pending.finish(); });
  if (change !== 'owner') {
    await waitFor(() => expect(repair).toHaveBeenCalledOnce());
    await repair.mock.results[0]?.value;
  } else {
    expect(repair).not.toHaveBeenCalled();
    expect(await db.translations.toArray()).toEqual(cached);
  }
  expect(await db.srsCards.get(saved.id)).toEqual(expected);
});

test('a late saved phrase cannot replace the next active selection', async () => {
  const repair = vi.spyOn(srsService, 'repairSavedPhrase');
  const pending = await startPhraseLookup(`${phraseSentence} We found clear evidence.`);
  await savePhrase();
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  const next = deferred<string>();
  mocks.complete.mockReturnValueOnce(next.promise);
  await userEvent.click(screen.getByRole('button', { name: 'clear' }));
  await userEvent.click(screen.getByRole('button', { name: 'select phrase →' }));
  await userEvent.click(screen.getByRole('button', { name: 'evidence' }));
  await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2));
  await act(async () => { pending.resolve('смутное подозрение'); await pending.finish(); });
  await waitFor(() => expect(repair).toHaveBeenCalledOnce());
  await repair.mock.results[0]?.value;
  expect(screen.getByText('clear evidence')).toBeInTheDocument();
  expect(screen.queryByText('— смутное подозрение')).toBeNull();
  expect(await db.srsCards.get(phraseId)).toMatchObject({ contextGloss: 'смутное подозрение' });
  await act(async () => { next.resolve('явное доказательство'); });
  await screen.findByText('— явное доказательство');
  expect(await db.srsCards.get('phrase:clear evidence')).toBeUndefined();
});
