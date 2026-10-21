import { act, fireEvent, render, screen } from '@testing-library/react';
import { ChapterStudy } from './ChapterStudy';
import { generateReaderExercises } from '@/features/ai/functions';

vi.mock('@/features/ai/functions', () => ({ generateReaderExercises: vi.fn() }));
vi.mock('@/features/ai/route', () => ({ useAiEnabled: () => true, useAiUnknown: () => true, aiAvailable: () => true,
  captureAiScope: (signal?: AbortSignal) => () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); },
}));
vi.mock('@/features/ai/AiUpsellLink', () => ({ AiUpsellLink: () => null }));
vi.mock('@/features/practice/exercises/ExerciseView', () => ({ ExerciseView: ({ exercise }: { exercise: { id: string } }) => <p>{exercise.id}</p> }));
vi.mock('./difficulty', () => ({ loadFreq: async () => new Map([['book', 1]]), rankThresholdFor: () => 100,
  estimateCoverage: () => ({ total: 40, coverage: .95, unknown: new Map([['boat', 1]]) }),
}));
vi.mock('./exercises', () => ({ generateExercises: () => [] }));
vi.mock('@/features/vocab/vocabStore', () => {
  const state = { statuses: new Map(), load: async () => {} };
  return { useVocabStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

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
  const signal = vi.mocked(generateReaderExercises).mock.calls.at(-1)?.[1].signal;
  view.rerender(<ChapterStudy text="Chapter two" idPrefix="two" />);
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve([{ type: 'choice', id: 'old-exercise', instruction: { en: 'Choose' }, tags: [], prompt: '___', options: ['a', 'b'], correctIndex: 0 }]));
  expect(screen.queryByText('old-exercise')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'AI exercises' })).toBeEnabled();
});

test('choosing local exercises supersedes pending AI generation', async () => {
  const old = deferred<Awaited<ReturnType<typeof generateReaderExercises>>>();
  vi.mocked(generateReaderExercises).mockReturnValueOnce(old.promise);
  render(<ChapterStudy text="Chapter one" idPrefix="one" />);
  fireEvent.click(await screen.findByRole('button', { name: 'AI exercises' }));
  fireEvent.click(screen.getByRole('button', { name: 'Exercises from this chapter' }));
  await act(async () => old.resolve([{ type: 'choice', id: 'old-exercise', instruction: { en: 'Choose' }, tags: [], prompt: '___', options: ['a', 'b'], correctIndex: 0 }]));
  expect(screen.queryByText('old-exercise')).not.toBeInTheDocument();
  expect(screen.getByText(/Barely any new words/)).toBeInTheDocument();
});
