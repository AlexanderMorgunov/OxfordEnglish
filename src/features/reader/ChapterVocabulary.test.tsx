import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { addWordCard, addPhraseCard } from '@/features/srs/service';
import { useAiStore } from '@/features/ai/store';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { useSavedPhrases } from './saved-phrases';
import { useReaderSettings } from './settings';
import { ChapterVocabulary } from './ChapterVocabulary';
import { ReadingText, WordToken } from './reading-text';
import { BookView } from './BookView';
import { chapterTermPrefix, readChapterTerms, saveReaderTerm } from './chapter-vocabulary';
import * as sourceService from './chapter-vocabulary';
import * as translations from './translate';
import * as cards from '@/features/srs/service';

vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
const source = { bookKey: 'reader.catalog.test', chapterId: 'one' };
const sentence = 'Take care near the river bank.';
const glossary = new Map([['Take', { ru: 'брать' }], ['care', { ru: 'забота' }], ['bank', { ru: 'берег' }]]);
beforeEach(async () => {
  invalidateDataScope();
  useAiStore.setState({ config: null });
  useReaderSettings.setState({ aiTranslation: false });
  useVocabStore.setState({ statuses: new Map(), ready: false });
  useSavedPhrases.setState({ phrases: new Set(), ready: true });
  await db.open();
  await Promise.all([db.settings, db.srsCards, db.wordStatus, db.pending, db.activity, db.reviewLog, db.attempts, db.translations].map((table) => table.clear()));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ words: [], map: {}, levels: [] }))));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('actual word save populates its chapter; a partial source failure is retryable without resetting the card', async () => {
  const save = vi.spyOn(sourceService, 'saveReaderTerm').mockResolvedValueOnce(false);
  render(<><ReadingText source={source} paragraphs={[sentence]} glossary={glossary} /><ChapterVocabulary source={source} /></>, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'bank' }));
  const dialog = within(screen.getByRole('dialog', { name: 'bank' }));
  await userEvent.click(dialog.getByRole('button', { name: 'learning' }));
  await screen.findByRole('alert');
  expect(await db.srsCards.get('word:bank')).toBeDefined();
  expect(await db.settings.count()).toBe(0);
  const before = await db.srsCards.get('word:bank');
  await userEvent.click(dialog.getByRole('button', { name: 'learning' }));
  await waitFor(() => expect(screen.getByText('Words from this chapter (1)')).toBeInTheDocument());
  expect(await db.srsCards.get('word:bank')).toEqual(before);
  expect(save).toHaveBeenCalledTimes(2);
});

test('an existing phrase can be explicitly saved from another chapter', async () => {
  await addPhraseCard('Take care', 'береги себя', 'Take care.');
  useSavedPhrases.getState().add('Take care');
  vi.spyOn(translations, 'translateReaderResult').mockResolvedValue({ text: 'береги себя', contextual: false });
  render(<ReadingText source={source} paragraphs={[sentence]} glossary={glossary} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'Take' }));
  await userEvent.click(screen.getByRole('button', { name: 'select phrase →' }));
  await userEvent.click(screen.getByRole('button', { name: 'care' }));
  await userEvent.click(screen.getByRole('button', { name: '+ save' }));
  await screen.findByRole('button', { name: '✓ saved' });
  expect(await readChapterTerms(source, await chapterTermPrefix(source))).toEqual([{ id: 'phrase:take care', front: 'Take care', answer: 'береги себя', sentence }]);
});

test('live edits invalidate practice and owner invalidation immediately hides the old words', async () => {
  await addWordCard('bank', 'берег');
  await addWordCard('river', 'река');
  await saveReaderTerm(source, 'word:bank');
  await saveReaderTerm(source, 'word:river');
  const view = render(<ChapterVocabulary source={source} />, { wrapper: MemoryRouter });
  await waitFor(() => expect(screen.getByText('Words from this chapter (2)')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Words from this chapter (2)'));
  const original = { srs: await db.srsCards.toArray(), attempts: await db.attempts.toArray(), log: await db.reviewLog.toArray(), activity: await db.activity.toArray(), statuses: await db.wordStatus.toArray() };
  await userEvent.click(screen.getByRole('button', { name: 'Match pairs' }));
  await userEvent.click(screen.getByRole('button', { name: 'bank' }));
  await userEvent.click(screen.getByRole('button', { name: 'берег' }));
  expect(await db.srsCards.toArray()).toEqual(original.srs);
  expect(await db.attempts.toArray()).toEqual(original.attempts);
  expect(await db.reviewLog.toArray()).toEqual(original.log);
  expect(await db.activity.toArray()).toEqual(original.activity);
  expect(await db.wordStatus.toArray()).toEqual(original.statuses);
  await userEvent.click(screen.getByRole('button', { name: 'Back to words' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Match pairs' })).toHaveFocus());
  await userEvent.click(screen.getByRole('button', { name: 'Match pairs' }));
  await act(async () => { await db.srsCards.update('word:bank', { back: 'банк' }); });
  await screen.findByText('The list changed. Start practice again.');
  expect(screen.queryByRole('group', { name: 'English words' })).toBeNull();
  expect(screen.getByText('банк')).toBeInTheDocument();
  act(() => invalidateDataScope());
  expect(screen.queryByText('банк')).toBeNull();
  expect(screen.queryByText('river')).toBeNull();
  expect(screen.queryByRole('group', { name: 'English words' })).toBeNull();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
  expect(screen.queryByText('банк')).toBeNull();
  expect(screen.getByText(/Account changed/)).toBeInTheDocument();
  view.rerender(<ChapterVocabulary source={{ ...source }} />);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
  expect(screen.queryByText('банк')).toBeNull();
  await db.settings.clear();
  await db.srsCards.clear();
  await addWordCard('fresh', 'новый');
  await saveReaderTerm(source, 'word:fresh');
  view.rerender(<ChapterVocabulary key="reopened" source={source} />);
  await waitFor(() => expect(screen.getByText('Words from this chapter (1)')).toBeInTheDocument());
});

test('short chapters still show the block and chapter navigation resets its source', async () => {
  render(<BookView book={{ title: 'Short book', chapters: [{ id: 'one', title: 'One', text: 'River.' }, { id: 'two', title: 'Two', text: 'Bank.' }] }} idPrefix={source.bookKey} />, { wrapper: MemoryRouter });
  await screen.findByText('Words from this chapter (0)');
  await userEvent.click(screen.getByText('Words from this chapter (0)'));
  expect(screen.getByText(/Save words and phrases while reading/)).toBeInTheDocument();
  const next = screen.getAllByRole('button', { name: /next/i })[0]!;
  await userEvent.click(next);
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bank' })).toBeInTheDocument());
});

test.each(['reader', 'learn'] as const)('an interrupted %s save cannot leave learning disabled for the next owner', async (surface) => {
  let finish!: (saved: boolean) => void;
  vi.spyOn(cards, 'addWordCard').mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  render(surface === 'reader' ? <ReadingText source={source} paragraphs={[sentence]} glossary={glossary} />
    : <WordToken word="bank" gloss={{ ru: 'берег' }} sentence={sentence} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'bank' }));
  const learning = within(screen.getByRole('dialog', { name: 'bank' })).getByRole('button', { name: 'learning' });
  await userEvent.click(learning);
  expect(learning).toBeDisabled();
  act(() => invalidateDataScope());
  if (surface === 'reader') {
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'bank' }));
  }
  const freshLearning = within(screen.getByRole('dialog', { name: 'bank' })).getByRole('button', { name: 'learning' });
  expect(freshLearning).toBeEnabled();
  await act(async () => { finish(false); });
  expect(freshLearning).toBeEnabled();
});

test('translations differing only in whitespace cannot start an empty discrimination round', async () => {
  await addWordCard('quick', 'очень  быстро');
  await addWordCard('fast', 'очень быстро');
  await saveReaderTerm(source, 'word:quick');
  await saveReaderTerm(source, 'word:fast');
  render(<ChapterVocabulary source={source} />, { wrapper: MemoryRouter });
  await waitFor(() => expect(screen.getByText('Words from this chapter (2)')).toBeInTheDocument());
  await userEvent.click(screen.getByText('Words from this chapter (2)'));
  expect(screen.getByRole('button', { name: 'Match pairs' })).toBeDisabled();
});
