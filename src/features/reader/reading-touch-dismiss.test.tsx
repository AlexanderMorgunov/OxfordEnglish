import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useAiStore } from '@/features/ai/store';
import { usePhraseSelect } from './phrase-select';
import { ReadingText, WordToken } from './reading-text';
import { BookView } from './BookView';

const lookup = vi.hoisted(() => vi.fn(async (word: string) => `translation of ${word}`));
vi.mock('@/features/vocab/translate', () => ({ translateWord: lookup }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('@/features/reader/difficulty', async (original) => ({ ...(await original<object>()), loadFreq: async () => null }));
vi.mock('@/features/vocab/lemma', async (original) => ({ ...(await original<object>()), useLemma: () => ({ byForm: new Map(), lemmas: new Set() }) }));
vi.mock('@/features/vocab/cefr', async (original) => ({ ...(await original<object>()), useCefr: () => new Map() }));
vi.mock('./translate', () => ({ translateReaderResult: async () => ({ text: 'перевод фразы', contextual: false }) }));
vi.mock('./ChapterStudy', () => ({ ChapterStudy: () => null }));
vi.mock('./ReaderWidget', () => ({ ReaderWidget: () => null }));
vi.mock('@/features/stats/useReadingTracker', () => ({ saveProgress: vi.fn(), useReadingTracker: () => {} }));

beforeEach(() => {
  lookup.mockClear();
  useAiStore.setState({ config: null });
  usePhraseSelect.getState().clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function reader() {
  return render(<ReadingText paragraphs={['Alpha beta gamma.']} />, { wrapper: MemoryRouter });
}
async function tap(target: HTMLElement) {
  await userEvent.pointer([{ keys: '[TouchA>]', target }, { keys: '[/TouchA]', target }]);
}

test('a touch on another reader word only dismisses; the next touch opens and requests it', async () => {
  reader();
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  expect(screen.getByRole('dialog', { name: 'Alpha' })).toBeInTheDocument();
  await tap(screen.getByRole('button', { name: 'beta' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(lookup.mock.calls.map(([word]) => word)).toEqual(['Alpha']);
  await tap(screen.getByRole('button', { name: 'beta' }));
  expect(screen.getByRole('dialog', { name: 'beta' })).toBeInTheDocument();
  expect(lookup.mock.calls.map(([word]) => word)).toEqual(['Alpha', 'beta']);
});

test('same-word taps close then reopen without repeating its lookup', async () => {
  reader();
  const word = screen.getByRole('button', { name: 'Alpha' });
  await tap(word);
  await tap(word);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await tap(word);
  expect(screen.getByRole('dialog', { name: 'Alpha' })).toBeInTheDocument();
  expect(lookup).toHaveBeenCalledOnce();
});

test('mouse switching stays direct after touch input', async () => {
  reader();
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  await userEvent.click(screen.getByRole('button', { name: 'beta' }));
  expect(screen.getByRole('dialog', { name: 'beta' })).toBeInTheDocument();
  expect(lookup.mock.calls.map(([word]) => word)).toEqual(['Alpha', 'beta']);
});

test('portaled close and phrase-selection controls remain operable by touch', async () => {
  reader();
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  await tap(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Alpha' })).toHaveFocus();
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  await tap(screen.getByRole('button', { name: 'select phrase →' }));
  await tap(screen.getByRole('button', { name: 'gamma' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(usePhraseSelect.getState().end).toMatchObject({ p: 0, s: 0 });
  expect(screen.getByText('Alpha beta gamma')).toBeInTheDocument();
  expect(lookup).toHaveBeenCalledOnce();
});

test('keyboard switches in one activation and Escape restores focus', async () => {
  reader();
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  const beta = screen.getByRole('button', { name: 'beta' });
  act(() => beta.focus());
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'beta' })).toBeInTheDocument();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await userEvent.keyboard('{Escape}');
  expect(beta).toHaveFocus();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('canceling a touch gesture does not suppress later keyboard or touch activation', async () => {
  reader();
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  const beta = screen.getByRole('button', { name: 'beta' });
  const user = userEvent.setup();
  await user.pointer({ keys: '[TouchA>]', target: beta });
  fireEvent.pointerCancel(beta, { pointerId: 2 });
  act(() => beta.focus());
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'beta' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await tap(screen.getByRole('button', { name: 'gamma' }));
  expect(screen.getByRole('dialog', { name: 'gamma' })).toBeInTheDocument();
});

test('standalone words outside book reader retain direct touch switching', async () => {
  render(<><WordToken word="Alpha" sentence="Alpha beta." /><WordToken word="beta" sentence="Alpha beta." /></>);
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  await tap(screen.getByRole('button', { name: 'beta' }));
  expect(screen.getByRole('dialog', { name: 'beta' })).toBeInTheDocument();
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
});

test('plain text dismisses so the next word touch opens immediately', async () => {
  reader();
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  await tap(screen.getByText('.'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await tap(screen.getByRole('button', { name: 'beta' }));
  expect(screen.getByRole('dialog', { name: 'beta' })).toBeInTheDocument();
});

test('changing the actual book chapter clears old lookup state before its first tap', async () => {
  const book = { title: 'QA', chapters: [{ id: 'one', text: 'Alpha beta.' }, { id: 'two', text: 'Omega beta.' }] };
  const changed = vi.fn();
  const view = render(<BookView book={book} idPrefix="reader.touch-qa" onChapter={changed} />, { wrapper: MemoryRouter });
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  fireEvent.change(screen.getAllByRole('combobox', { name: 'Chapter' })[0]!, { target: { value: '1' } });
  expect(changed).toHaveBeenCalledWith(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await tap(screen.getByRole('button', { name: 'Omega' }));
  expect(screen.getByRole('dialog', { name: 'Omega' })).toHaveTextContent('translation of Omega');
  expect(lookup.mock.calls.map(([word]) => word)).toEqual(['Alpha', 'Omega']);
  view.unmount();
  reader();
  await tap(screen.getByRole('button', { name: 'gamma' }));
  expect(screen.getByRole('dialog', { name: 'gamma' })).toBeInTheDocument();
});

test('previous panel cleanup cannot clear the new panel registration', async () => {
  reader();
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  for (const word of ['beta', 'gamma']) {
    act(() => screen.getByRole('button', { name: word }).focus());
    await userEvent.keyboard('{Enter}');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: word })).toBeInTheDocument();
  }
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
