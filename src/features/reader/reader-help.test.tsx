import 'fake-indexeddb/auto';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAiStore } from '@/features/ai/store';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { useReaderSettings } from './settings';
import { useSavedPhrases } from './saved-phrases';
import { usePhraseSelect } from './phrase-select';
import { ReadingText } from './reading-text';
import * as service from '@/features/srs/service';

const mocks = vi.hoisted(() => ({ context: vi.fn(), phrase: vi.fn() }));
vi.mock('@/features/ai/functions', async (original) => ({
  ...(await original<object>()),
  wordInContext: mocks.context,
}));
vi.mock('./translate', () => ({ translateReaderResult: mocks.phrase }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({
  useSpeechAvailable: () => false,
}));
vi.mock('./difficulty', async (original) => ({
  ...(await original<object>()),
  loadFreq: async () => null,
}));
vi.mock('@/features/vocab/lemma', async (original) => ({
  ...(await original<object>()),
  useLemma: () => ({ byForm: new Map(), lemmas: new Set() }),
}));
vi.mock('@/features/vocab/cefr', async (original) => ({
  ...(await original<object>()),
  useCefr: () => new Map(),
}));

let user = userEvent.setup({ delay: null });
const sentence = 'Alpha beta gamma.';
const glossary = new Map([
  ['alpha', { ru: 'альфа' }],
  ['beta', { ru: 'бета' }],
  ['gamma', { ru: 'гамма' }],
]);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function reader() {
  return render(
    <>
      <aside id="help-target" />
      <ReadingText
        paragraphs={[sentence]}
        glossary={glossary}
        helpTargetId="help-target"
      />
    </>,
    { wrapper: MemoryRouter }
  );
}
function media(wide: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('min-width') ? wide : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}
beforeEach(async () => {
  user = userEvent.setup({ delay: null });
  invalidateDataScope();
  mocks.context.mockReset();
  mocks.phrase.mockReset();
  mocks.phrase.mockResolvedValue({
    text: 'перевод',
    source: 'free',
    contextual: false,
  });
  useAiStore.setState({
    config: {
      provider: 'custom',
      apiKey: 'fixture-only',
      baseUrl: 'https://fixture.invalid',
      model: 'fixture',
    },
  });
  useReaderSettings.setState({ coloring: false, aiTranslation: false });
  useVocabStore.setState({ statuses: new Map(), ready: false });
  useSavedPhrases.setState({ phrases: new Set(), ready: true });
  usePhraseSelect.getState().clear();
  await db.open();
  await Promise.all([
    db.srsCards.clear(),
    db.wordStatus.clear(),
    db.pending.clear(),
    db.activity.clear(),
    db.reviewLog.clear(),
    db.translations.clear(),
  ]);
  media(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

test('book help uses reserved rail, exact original and explicit context; late AI cannot replace own saved meaning', async () => {
  const pending = deferred<string>();
  mocks.context.mockReturnValue(pending.promise);
  const view = reader();
  const alpha = screen.getByRole('button', { name: 'Alpha' });
  await user.click(alpha);
  let panel = screen.getByRole('dialog', { name: 'Alpha' });
  expect(view.container.querySelector('#help-target')).toContainElement(panel);
  expect(within(panel).getByText(sentence)).toHaveAttribute('lang', 'en');
  expect(mocks.context).not.toHaveBeenCalled();
  expect(await db.srsCards.count()).toBe(0);
  await user.click(
    within(panel).getByRole('button', { name: 'Refine meaning' })
  );
  await waitFor(() => expect(mocks.context).toHaveBeenCalledOnce());
  await user.clear(within(panel).getByLabelText('Your meaning to save'));
  await user.type(
    within(panel).getByLabelText('Your meaning to save'),
    'Моё значение'
  );
  await user.click(within(panel).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () =>
    expect(await db.srsCards.get('word:alpha')).toMatchObject({
      back: 'Моё значение',
      contextGloss: 'Моё значение',
      contextSentence: sentence,
    })
  );
  const saved = (await db.srsCards.get('word:alpha'))!;
  await user.click(within(panel).getByRole('button', { name: 'Close' }));
  expect(alpha).toHaveFocus();
  await act(async () => {
    pending.resolve('Поздний ответ');
  });
  await waitFor(async () =>
    expect(await db.srsCards.get('word:alpha')).toEqual(saved)
  );
  await user.click(alpha);
  panel = screen.getByRole('dialog', { name: 'Alpha' });
  await user.click(within(panel).getByRole('button', { name: 'known' }));
  await waitFor(async () =>
    expect((await db.wordStatus.get('alpha'))?.status).toBe('known')
  );
  await user.click(within(panel).getByRole('button', { name: 'ignore' }));
  await waitFor(async () =>
    expect((await db.wordStatus.get('alpha'))?.status).toBe('ignored')
  );
  expect(await db.srsCards.get('word:alpha')).toEqual(saved);
  expect(await db.reviewLog.count()).toBe(0);
});

test('native mobile sheet closes with Escape and restores its word focus', async () => {
  media(false);
  const show = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.querySelector('button')?.focus();
  });
  const close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: show,
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: close,
  });
  reader();
  const alpha = screen.getByRole('button', { name: 'Alpha' });
  await user.click(alpha);
  expect(show).toHaveBeenCalledOnce();
  expect(screen.getByRole('dialog', { name: 'Alpha' }).tagName).toBe('DIALOG');
  await user.keyboard('{Escape}');
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(alpha).toHaveFocus();
});

test('book phrase manual edits survive late translation and can be explicitly edited again without resetting FSRS', async () => {
  const pending = deferred<{
    text: string;
    source: 'free';
    contextual: false;
  }>();
  mocks.phrase.mockReturnValue(pending.promise);
  reader();
  await user.click(screen.getByRole('button', { name: 'Alpha' }));
  await user.click(
    screen.getByRole('button', { name: 'Select a phrase from this word' })
  );
  await user.click(screen.getByRole('button', { name: 'gamma' }));
  const panel = screen.getByRole('dialog', { name: 'Alpha beta gamma' });
  await user.type(
    within(panel).getByLabelText('Your meaning to save'),
    'Своё значение фразы'
  );
  await user.click(within(panel).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () =>
    expect(await db.srsCards.get('phrase:alpha beta gamma')).toMatchObject({
      back: 'Своё значение фразы',
    })
  );
  const saved = (await db.srsCards.get('phrase:alpha beta gamma'))!;
  await act(async () => {
    pending.resolve({
      text: 'Поздняя фраза',
      source: 'free',
      contextual: false,
    });
  });
  expect(within(panel).getByLabelText('Your meaning to save')).toHaveValue(
    'Своё значение фразы'
  );
  await user.clear(within(panel).getByLabelText('Your meaning to save'));
  await user.type(
    within(panel).getByLabelText('Your meaning to save'),
    'Исправлено'
  );
  await user.click(within(panel).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () =>
    expect(await db.srsCards.get(saved.id)).toMatchObject({
      back: 'Исправлено',
      card: saved.card,
    })
  );
  expect(
    (await db.activity.toArray()).reduce(
      (sum, entry) => sum + entry.phrasesSaved,
      0
    )
  ).toBe(1);
  await user.click(within(panel).getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'Alpha' }));
  await user.click(
    screen.getByRole('button', { name: 'Select a phrase from this word' })
  );
  await user.click(screen.getByRole('button', { name: 'gamma' }));
  const reopened = screen.getByRole('dialog', { name: 'Alpha beta gamma' });
  await waitFor(() =>
    expect(within(reopened).getByLabelText('Your meaning to save')).toHaveValue(
      'Исправлено'
    )
  );
  expect(within(reopened).getByText('Your saved meaning')).toBeInTheDocument();
  expect(mocks.phrase).toHaveBeenCalledOnce();
});

test('failed explicit save keeps manual draft for a real retry', async () => {
  const save = vi.spyOn(service, 'addWordCard').mockResolvedValueOnce(false);
  reader();
  await user.click(screen.getByRole('button', { name: 'Alpha' }));
  const panel = screen.getByRole('dialog', { name: 'Alpha' });
  await user.clear(within(panel).getByLabelText('Your meaning to save'));
  await user.type(
    within(panel).getByLabelText('Your meaning to save'),
    'Черновик'
  );
  await user.click(within(panel).getByRole('button', { name: 'Learn · save' }));
  expect(await within(panel).findByRole('alert')).toHaveTextContent(
    'Could not save'
  );
  expect(within(panel).getByLabelText('Your meaning to save')).toHaveValue(
    'Черновик'
  );
  save.mockRestore();
  await user.click(within(panel).getByRole('button', { name: 'Learn · save' }));
  await waitFor(async () =>
    expect((await db.srsCards.get('word:alpha'))?.back).toBe('Черновик')
  );
});

test('sentence helper aborts cancelled work, preserves original and labels actual free result', async () => {
  const pending = deferred<{
    text: string;
    source: 'free';
    contextual: false;
  }>();
  mocks.phrase.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({
    text: 'Бесплатный ответ',
    source: 'free',
    contextual: false,
  });
  reader();
  await user.click(screen.getByRole('button', { name: 'Sentence actions' }));
  const panel = screen.getByRole('dialog', { name: 'Sentence help' });
  expect(within(panel).getByText(sentence)).toBeInTheDocument();
  await user.click(within(panel).getByRole('button', { name: 'Translate' }));
  await user.click(
    within(panel).getByRole('button', { name: 'Cancel request' })
  );
  expect(mocks.phrase.mock.calls[0]?.[1].signal.aborted).toBe(true);
  await act(async () => {
    pending.resolve({
      text: 'Поздний ответ',
      source: 'free',
      contextual: false,
    });
  });
  expect(within(panel).queryByText('Поздний ответ')).toBeNull();
  await user.click(within(panel).getByRole('button', { name: 'Translate' }));
  expect(
    await within(panel).findByText('Бесплатный ответ')
  ).toBeInTheDocument();
  expect(within(panel).getByText('Free translation')).toBeInTheDocument();
  expect(await db.srsCards.count()).toBe(0);
});

test('desktop book touch first dismisses the existing word and next touch opens the other word', async () => {
  reader();
  const user = userEvent.setup();
  const tap = async (target: HTMLElement) =>
    user.pointer([
      { keys: '[TouchA>]', target },
      { keys: '[/TouchA]', target },
    ]);
  await tap(screen.getByRole('button', { name: 'Alpha' }));
  await tap(screen.getByRole('button', { name: 'beta' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await tap(screen.getByRole('button', { name: 'beta' }));
  expect(screen.getByRole('dialog', { name: 'beta' })).toBeInTheDocument();
});
