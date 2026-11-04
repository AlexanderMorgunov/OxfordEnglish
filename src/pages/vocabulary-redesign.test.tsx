import 'fake-indexeddb/auto';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { installDialogMock } from '@/test/dialog';
import { invalidateDataScope } from '@/features/account/dataScope';
import * as mutations from '@/features/vocab/vocabulary-mutations';
import { useVocabularyView } from '@/features/vocab/navigation';
import { VocabularyPage } from './VocabularyPage';
import { useEntitlement } from '@/features/account/entitlement';
import { requestWordSenses } from '@/features/vocab/word-senses';

vi.mock('@/shared/lib/useSpeechAvailable', () => ({
  useSpeechAvailable: () => false,
}));
vi.mock('@/features/vocab/word-senses', () => ({ requestWordSenses: vi.fn() }));
vi.mock('@/features/vocab/lemma', () => ({
  useLemma: () => ({ byForm: new Map(), lemmas: new Set() }),
  baseForm: () => null,
  isFormOf: (word: string, term: string) => word === term,
}));
vi.mock('@/features/vocab/cefr', () => ({
  useCefr: () => new Map(),
  cefrOf: () => null,
}));
beforeEach(async () => {
  vi.restoreAllMocks();
  useEntitlement.setState({ entitlement: null });
  vi.mocked(requestWordSenses)
    .mockReset()
    .mockResolvedValue({
      path: 'managed',
      cached: false,
      senses: [
        {
          partOfSpeech: 'noun',
          translation: 'берег',
          distinction: 'Край реки',
          example: 'We sat on the bank.',
        },
      ],
    });
  installDialogMock();
  invalidateDataScope();
  useVocabularyView.getState().reset();
  await db.open();
  await Promise.all(
    [db.srsCards, db.wordStatus, db.translations, db.pending, db.activity].map(
      (t) => t.clear()
    )
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            responseData: { translatedText: 'пример перевода' },
          })
        )
    )
  );
});
function Back() {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(-1)}>History back</button>;
}
function show() {
  return render(
    <MemoryRouter initialEntries={['/vocabulary']}>
      <button>Outside navigation</button>
      <Back />
      <VocabularyPage />
    </MemoryRouter>
  );
}
async function openAdd() {
  const button = await screen.findByRole('button', {
    name: 'Add a word or phrase',
  });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  return screen.getByLabelText('English word or phrase');
}
async function openEntry(term: string) {
  await userEvent.click(
    await screen.findByRole('link', { name: new RegExp('^' + term + ' —') })
  );
  await screen.findByRole('heading', { level: 1, name: term });
}
async function save(term: string, answer = 'перевод') {
  fireEvent.change(screen.getByLabelText('English word or phrase'), {
    target: { value: term },
  });
  fireEvent.change(screen.getByLabelText('Translation'), {
    target: { value: answer },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Save in vocabulary' })
  );
}

test('known and hidden are independent of the review card and affect overlapping filters', async () => {
  await mutations.createVocabularyEntry('curious', 'любознательный', '');
  show();
  await openEntry('curious');
  const original = await db.srsCards.get('word:curious');
  await userEvent.selectOptions(screen.getByLabelText('My status'), 'known');
  await waitFor(async () =>
    expect((await db.wordStatus.get('curious'))?.status).toBe('known')
  );
  expect(await db.srsCards.get('word:curious')).toEqual(original);
  await userEvent.selectOptions(screen.getByLabelText('My status'), 'ignored');
  await screen.findByText(/hidden words are excluded/);
  await userEvent.click(
    screen.getByRole('button', { name: '← My vocabulary' })
  );
  await screen.findByRole('heading', { name: 'No matches' });
  await userEvent.click(screen.getByRole('button', { name: /^Hidden/ }));
  await openEntry('curious');
  await userEvent.selectOptions(screen.getByLabelText('My status'), 'learning');
  await waitFor(async () =>
    expect((await db.wordStatus.get('curious'))?.status).toBe('learning')
  );
  expect(await db.srsCards.get('word:curious')).toEqual(original);
});

test('card-only removal requires confirmation, then leaves the detail and preserves a tombstone', async () => {
  await mutations.createVocabularyEntry('curious', 'любознательный', '');
  show();
  await openEntry('curious');
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove from review' })
  );
  expect(screen.getByText(/no separate status/)).toBeVisible();
  expect((await db.srsCards.get('word:curious'))?.deletedAt).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Keep card' }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove from review' })
  );
  await userEvent.click(screen.getByRole('button', { name: 'Remove card' }));
  await screen.findByRole('heading', { name: 'Your first words belong here' });
  expect((await db.srsCards.get('word:curious'))?.deletedAt).toBeDefined();
});

test('known status-only term can join review and remains in the dictionary after removal', async () => {
  await db.wordStatus.put({
    word: 'quiet',
    status: 'known',
    firstSeenAt: 1,
    encounters: 9,
  });
  show();
  await openEntry('quiet');
  await userEvent.click(screen.getByRole('button', { name: 'Add to review' }));
  await screen.findByRole('button', { name: 'Remove from review' });
  expect((await db.wordStatus.get('quiet'))?.status).toBe('known');
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove from review' })
  );
  expect(screen.getByText(/word and its status stay/)).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Remove card' }));
  await screen.findByText(/not restored automatically/);
  expect(screen.getByLabelText('My status')).toHaveValue('known');
  expect((await db.wordStatus.get('quiet'))?.encounters).toBe(9);
});

test('native Back retains search/sort/filter and entry URLs never contain the saved term', async () => {
  await mutations.createVocabularyEntry('curious', 'любознательный', '');
  show();
  await screen.findByRole('link', { name: /^curious —/ });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'CUR' } });
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Word order' }),
    'alpha'
  );
  const link = screen.getByRole('link', { name: /^curious —/ });
  expect(link.getAttribute('href')).toMatch(
    /^\/vocabulary\/entry\/[a-f0-9]{16}$/
  );
  await userEvent.click(link);
  await screen.findByRole('heading', { name: 'curious', level: 1 });
  await userEvent.click(screen.getByRole('button', { name: 'History back' }));
  expect(await screen.findByRole('searchbox')).toHaveValue('CUR');
  expect(screen.getByRole('combobox', { name: 'Word order' })).toHaveValue(
    'alpha'
  );
});

test('successful capture offers a fresh next draft without overwriting the preceding card', async () => {
  show();
  await openAdd();
  await save('curious');
  await screen.findByRole('button', { name: 'Add another' });
  await userEvent.click(screen.getByRole('button', { name: 'Add another' }));
  expect(screen.getByLabelText('English word or phrase')).toHaveValue('');
  expect(screen.getByLabelText('Translation')).toHaveValue('');
  await save('quiet', 'тихий');
  await screen.findByRole('button', { name: 'View word' });
  expect((await db.srsCards.get('word:curious'))?.back).toBe('перевод');
  expect(await db.srsCards.count()).toBe(2);
});

test('ordinary duplicate redirects to the existing entry without changing its schedule or answer', async () => {
  await mutations.createVocabularyEntry(
    'curious',
    'любознательный',
    'Original context.'
  );
  const before = await db.srsCards.get('word:curious');
  show();
  await openAdd();
  await save('CURIOUS', 'перезаписать');
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open existing word' })
  );
  await screen.findByRole('heading', { name: 'curious', level: 1 });
  expect(await db.srsCards.get('word:curious')).toEqual(before);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('a cancelled pending commit cannot write after another capture has started', async () => {
  const original = mutations.createVocabularyEntry;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(mutations, 'createVocabularyEntry').mockImplementationOnce(
    (...args) => blocked.then(() => original(...args))
  );
  show();
  await openAdd();
  await save('curious');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await openAdd();
  fireEvent.change(screen.getByLabelText('English word or phrase'), {
    target: { value: 'quiet' },
  });
  await act(async () => {
    release();
    await expect(
      vi.mocked(mutations.createVocabularyEntry).mock.results[0]?.value
    ).rejects.toThrow();
  });
  expect(await db.srsCards.count()).toBe(0);
  expect(screen.getByLabelText('English word or phrase')).toHaveValue('quiet');
});

test('a failed database read is retryable and does not claim first-use or zero counts', async () => {
  const failure = vi
    .spyOn(db.wordStatus, 'toArray')
    .mockRejectedValueOnce(new Error('Unavailable'));
  show();
  await screen.findByRole('heading', { name: 'Could not open vocabulary' });
  expect(
    screen.queryByRole('heading', { name: 'Your first words belong here' })
  ).toBeNull();
  expect(screen.getByRole('button', { name: /^All/ })).toHaveTextContent('—');
  failure.mockRestore();
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByRole('heading', { name: 'Your first words belong here' });
});

test('account handover invalidates capture, view filters and late completion', async () => {
  show();
  await openAdd();
  fireEvent.change(screen.getByLabelText('English word or phrase'), {
    target: { value: 'private draft' },
  });
  act(() => invalidateDataScope());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(useVocabularyView.getState().query).toBe('');
  await openAdd();
  expect(screen.getByLabelText('English word or phrase')).toHaveValue('');
  expect(await db.srsCards.count()).toBe(0);
});

test('a transient live read failure preserves an open translation draft through retry', async () => {
  await mutations.createVocabularyEntry('curious', 'любознательный', '');
  show();
  await openEntry('curious');
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit translation' })
  );
  fireEvent.change(screen.getByLabelText('Translation'), {
    target: { value: 'мой черновик' },
  });
  const failed = vi
    .spyOn(db.wordStatus, 'toArray')
    .mockRejectedValueOnce(new Error('Read unavailable'));
  await act(async () => {
    await db.srsCards.update('word:curious', { createdAt: 44 });
  });
  await screen.findByRole('heading', { name: 'Could not open vocabulary' });
  failed.mockRestore();
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByRole('heading', { name: 'curious', level: 1 });
  expect(screen.getByLabelText('Translation')).toHaveValue('мой черновик');
});

test('large dictionaries disclose eight rows at a time and filters reset the visible limit', async () => {
  for (let i = 0; i < 19; i++)
    await mutations.createVocabularyEntry(`word ${i}`, 'перевод', '');
  show();
  await waitFor(() =>
    expect(document.querySelectorAll('.vc-entry-link')).toHaveLength(8)
  );
  await userEvent.click(screen.getByRole('button', { name: 'Show more · 11' }));
  expect(document.querySelectorAll('.vc-entry-link')).toHaveLength(16);
  await userEvent.click(screen.getByRole('button', { name: /^Phrases/ }));
  expect(document.querySelectorAll('.vc-entry-link')).toHaveLength(8);
});

test('reopening the active translation editor preserves its unsaved text', async () => {
  await mutations.createVocabularyEntry('curious', 'любознательный', '');
  show();
  await openEntry('curious');
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit translation' })
  );
  fireEvent.change(screen.getByLabelText('Translation'), {
    target: { value: 'мой черновик' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit translation' })
  );
  expect(screen.getByLabelText('Translation')).toHaveValue('мой черновик');
  expect(screen.getByLabelText('Translation')).toHaveFocus();
});

test.each(['', 'мой перевод'])(
  'AI example carries its meaning into an empty answer, preserving manual answer %s',
  async (answer) => {
    useEntitlement.setState({
      entitlement: { plan: 'pro', active: true, ai: { used: 0, limit: 4000 } },
    });
    show();
    await openAdd();
    fireEvent.change(screen.getByLabelText('English word or phrase'), {
      target: { value: 'bank' },
    });
    fireEvent.change(screen.getByLabelText('Translation'), {
      target: { value: answer },
    });
    await userEvent.click(screen.getByText('Add example'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Create example · AI' })
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Use example 1' })
    );
    expect(screen.getByLabelText('Translation')).toHaveValue(answer || 'берег');
    expect(screen.getByLabelText('Example or context')).toHaveValue(
      'We sat on the bank.'
    );
    expect(screen.getByLabelText('Translation')).toHaveAttribute(
      'aria-required',
      'true'
    );
    expect(
      screen.getByRole('checkbox', {
        name: 'My example matches the chosen meaning',
      })
    ).toBeChecked();
  }
);
