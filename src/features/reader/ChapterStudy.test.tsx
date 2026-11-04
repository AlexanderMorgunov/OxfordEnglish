import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ChapterStudy } from './ChapterStudy';
import { generateReaderExercises } from '@/features/ai/functions';
import { generateExercises } from './exercises';
import { loadFreq } from './difficulty';
import { invalidateDataScope } from '@/features/account/dataScope';
import { createSessionResults } from '@/features/progress/sessionResults';
import { ExerciseSessionContext } from '@/features/practice/exercises/session';

vi.mock('@/features/ai/functions', () => ({
  generateReaderExercises: vi.fn(),
}));
vi.mock('@/features/ai/route', () => ({
  useAiEnabled: () => true,
  useAiUnknown: () => true,
  aiAvailable: () => true,
  captureAiScope: (signal?: AbortSignal) => () => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  },
}));
vi.mock('@/features/ai/AiUpsellLink', () => ({ AiUpsellLink: () => null }));
vi.mock('@/features/practice/exercises/ExerciseView', () => ({
  ExerciseView: ({
    exercise,
    onSolved,
  }: {
    exercise: { id: string };
    onSolved: () => void;
  }) => (
    <>
      <p data-testid="reader-exercise-id">{exercise.id}</p>
      <button onClick={onSolved}>Solve</button>
    </>
  ),
}));
vi.mock('./difficulty', () => ({
  loadFreq: vi.fn(async () => new Map([['book', 1]])),
  rankThresholdFor: () => 100,
  estimateCoverage: () => ({
    total: 40,
    coverage: 0.95,
    unknown: new Map([['boat', 1]]),
  }),
}));
vi.mock('./exercises', () => ({ generateExercises: vi.fn(() => []) }));
vi.mock('@/features/vocab/vocabStore', () => {
  const state = { statuses: new Map(), load: async () => {} };
  return {
    useVocabStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(generateExercises).mockReset().mockReturnValue([]);
  vi.mocked(generateReaderExercises).mockReset();
  vi.mocked(loadFreq)
    .mockReset()
    .mockResolvedValue(new Map([['book', 1]]));
});

test('unknown entitlement allows explicit chapter generation', async () => {
  vi.mocked(generateReaderExercises).mockResolvedValueOnce([]);
  render(<ChapterStudy text="Chapter one" idPrefix="one" />);
  fireEvent.click(await screen.findByRole('button', { name: 'AI exercises' }));
  expect(generateReaderExercises).toHaveBeenCalledOnce();
  await screen.findByRole('alert');
});

test('chapter navigation aborts and discards the old response', async () => {
  const old = deferred<Awaited<ReturnType<typeof generateReaderExercises>>>();
  vi.mocked(generateReaderExercises).mockReturnValueOnce(old.promise);
  const view = render(<ChapterStudy text="Chapter one" idPrefix="one" />);
  fireEvent.click(await screen.findByRole('button', { name: 'AI exercises' }));
  const signal = vi
    .mocked(generateReaderExercises)
    .mock.calls.at(-1)?.[1].signal;
  view.rerender(<ChapterStudy text="Chapter two" idPrefix="two" />);
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    old.resolve([
      {
        type: 'choice',
        id: 'old-exercise',
        instruction: { en: 'Choose' },
        tags: [],
        prompt: '___',
        options: ['a', 'b'],
        correctIndex: 0,
      },
    ])
  );
  expect(screen.queryByText(/old-exercise/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'AI exercises' })).toBeEnabled();
});

test('choosing local exercises supersedes pending AI generation', async () => {
  const old = deferred<Awaited<ReturnType<typeof generateReaderExercises>>>();
  vi.mocked(generateReaderExercises).mockReturnValueOnce(old.promise);
  render(<ChapterStudy text="Chapter one" idPrefix="one" />);
  fireEvent.click(await screen.findByRole('button', { name: 'AI exercises' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Exercises from this chapter' })
    ).toBeEnabled()
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Exercises from this chapter' })
  );
  await act(async () =>
    old.resolve([
      {
        type: 'choice',
        id: 'old-exercise',
        instruction: { en: 'Choose' },
        tags: [],
        prompt: '___',
        options: ['a', 'b'],
        correctIndex: 0,
      },
    ])
  );
  expect(screen.queryByText(/old-exercise/)).not.toBeInTheDocument();
  expect(
    screen.getByText(/No suitable words and sentences/)
  ).toBeInTheDocument();
});

test('mounting does not generate and local practice advances only after a solved answer', async () => {
  const make = (id: string) => ({
    type: 'choice' as const,
    id,
    instruction: { en: 'Choose' },
    tags: [],
    prompt: '___',
    options: ['a', 'b'],
    correctIndex: 0,
  });
  vi.mocked(generateExercises).mockReturnValueOnce([
    make('local-first'),
    make('local-second'),
  ]);
  const calls = vi.mocked(generateExercises).mock.calls.length;
  render(<ChapterStudy text="Chapter one" idPrefix="one" embedded />);
  const start = await screen.findByRole('button', {
    name: 'Exercises from this chapter',
  });
  await waitFor(() => expect(start).toBeEnabled());
  expect(generateExercises).toHaveBeenCalledTimes(calls);
  fireEvent.click(start);
  expect(screen.getByText(/local-first/)).toBeInTheDocument();
  expect(screen.queryByText(/local-second/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Next exercise' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next exercise' }));
  expect(screen.getByText(/local-second/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Solve' }));
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
  expect(
    screen.getByRole('heading', { name: 'Practice complete' })
  ).toHaveFocus();
  expect(screen.getByText(/Exercises completed:/)).toHaveTextContent('2');
});

test('cancellation and account changes discard pending generation without replacing the current menu', async () => {
  const old = deferred<Awaited<ReturnType<typeof generateReaderExercises>>>();
  vi.mocked(generateReaderExercises).mockReturnValueOnce(old.promise);
  render(<ChapterStudy text="Chapter one" idPrefix="one" />);
  fireEvent.click(await screen.findByRole('button', { name: 'AI exercises' }));
  const signal = vi
    .mocked(generateReaderExercises)
    .mock.calls.at(-1)?.[1].signal;
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve([]));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  const other = deferred<Awaited<ReturnType<typeof generateReaderExercises>>>();
  vi.mocked(generateReaderExercises).mockReturnValueOnce(other.promise);
  fireEvent.click(screen.getByRole('button', { name: 'AI exercises' }));
  const otherSignal = vi
    .mocked(generateReaderExercises)
    .mock.calls.at(-1)?.[1].signal;
  act(() => invalidateDataScope());
  expect(otherSignal?.aborted).toBe(true);
  await act(async () => other.resolve([]));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'AI exercises' })).toBeEnabled();
});

test('missing frequency data never presents invented coverage or hides the AI menu', async () => {
  vi.mocked(loadFreq).mockResolvedValueOnce(new Map());
  render(<ChapterStudy text="Chapter one" idPrefix="one" />);
  await screen.findByText(/The frequency list is unavailable/);
  expect(
    screen.getByRole('button', { name: 'Exercises from this chapter' })
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'AI exercises' })).toBeEnabled();
  expect(screen.queryByText(/95%/)).not.toBeInTheDocument();
});

test('a generated question retains its identity on retry while a changed answer or prompt cannot inherit solved state', async () => {
  const original = {
    type: 'choice' as const,
    id: 'same-index',
    instruction: { en: 'Choose' },
    tags: [],
    prompt: 'The ___ is blue.',
    options: ['sea', 'sand'],
    correctIndex: 0,
  };
  vi.mocked(generateExercises)
    .mockReturnValueOnce([original])
    .mockReturnValueOnce([{ ...original }])
    .mockReturnValueOnce([
      { ...original, prompt: 'The ___ is yellow.', correctIndex: 1 },
    ]);
  const results = createSessionResults();
  render(
    <ExerciseSessionContext value={results}>
      <ChapterStudy text="Chapter one" idPrefix="one" />
    </ExerciseSessionContext>
  );
  const start = await screen.findByRole('button', {
    name: 'Exercises from this chapter',
  });
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  const firstId = screen.getByTestId('reader-exercise-id').textContent!;
  act(() => results.getState().record(firstId, true, []));
  expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Choose practice' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Exercises from this chapter' })
  );
  expect(screen.getByTestId('reader-exercise-id')).toHaveTextContent(firstId);
  expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Choose practice' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Exercises from this chapter' })
  );
  expect(screen.getByTestId('reader-exercise-id').textContent).not.toBe(
    firstId
  );
  expect(
    screen.queryByRole('button', { name: 'Finish' })
  ).not.toBeInTheDocument();
});
