import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import type { SrsCard } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';

const mocks = vi.hoisted(() => ({
  translate: vi.fn(),
  repair: vi.fn(),
  grade: vi.fn(),
  edit: vi.fn(),
  ai: vi.fn(),
  enabled: false,
}));
vi.mock('./service', async () => {
  const { Rating } = await import('ts-fsrs');
  return {
    Rating,
    canPronounce: () => false,
    repairCardBack: mocks.repair,
    gradeCard: mocks.grade,
  };
});
vi.mock('@/features/vocab/translate', () => ({
  translateText: mocks.translate,
  translateWord: mocks.translate,
}));
vi.mock('@/features/vocab/manage', async (original) => ({
  ...(await original<object>()),
  editCardAnswer: mocks.edit,
}));
vi.mock('@/features/vocab/lemma', () => ({
  useLemma: () => ({ byForm: new Map(), lemmas: new Set() }),
  baseForm: () => null,
  isFormOf: (word: string, term: string) => word === term,
}));
vi.mock('@/features/vocab/cefr', () => ({
  useCefr: () => new Map(),
  cefrOf: () => null,
}));
vi.mock('@/features/ai/route', () => ({
  useAiEnabled: () => mocks.enabled,
  useAiUnknown: () => false,
}));
vi.mock('@/features/ai/functions', () => ({ aiTranslate: mocks.ai }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({
  useSpeechAvailable: () => false,
}));

const { ReviewCard } = await import('./ReviewCard');
const saved = (over: Partial<SrsCard> = {}): SrsCard => {
  const schedule = createEmptyCard(new Date(0));
  return {
    id: 'word:armigerous',
    kind: 'word',
    front: 'armigerous',
    back: 'armigerous',
    tags: [],
    due: schedule.due,
    card: schedule,
    ...over,
  };
};
const advance = vi.fn();
const skip = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = false;
  mocks.translate.mockResolvedValue(null);
  mocks.repair.mockResolvedValue(true);
  mocks.grade.mockResolvedValue(true);
  mocks.edit.mockResolvedValue(true);
});

test('context-only answer is usable without a dictionary request, with the English context visible first', async () => {
  render(
    <ReviewCard
      card={saved({
        contextGloss: 'имеющий герб',
        contextSentence: 'An armigerous family.',
      })}
      onAdvance={advance}
      onSkip={skip}
    />
  );
  expect(screen.getByText(/An/)).toHaveTextContent('An armigerous family.');
  expect(
    screen
      .getAllByText('armigerous')
      .some((element) => element.tagName === 'STRONG')
  ).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  expect(screen.getByText('имеющий герб')).toBeInTheDocument();
  expect(mocks.translate).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'good' }));
  expect(mocks.grade).toHaveBeenCalledOnce();
});

test('an unanswered card can be skipped without a grade and edited manually', async () => {
  render(<ReviewCard card={saved()} onAdvance={advance} onSkip={skip} />);
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  expect(
    await screen.findByText(/Translation unavailable/)
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'good' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(skip).toHaveBeenCalledOnce();
  expect(mocks.grade).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Edit answer' }));
  await userEvent.type(
    screen.getByRole('textbox', { name: 'General translation' }),
    'имеющий герб'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(mocks.edit).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'word:armigerous' }),
    'имеющий герб',
    '',
    expect.any(Function)
  );
});

test('late lookup does not spill into the next keyed card or a previous data owner', async () => {
  let resolve!: (value: string) => void;
  mocks.translate.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      })
  );
  const { rerender } = render(
    <ReviewCard key="a" card={saved()} onAdvance={advance} onSkip={skip} />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  rerender(
    <ReviewCard
      key="b"
      card={saved({ id: 'word:all', front: 'all', back: 'all' })}
      onAdvance={advance}
      onSkip={skip}
    />
  );
  await act(async () => {
    resolve('имеющий герб');
  });
  expect(screen.queryByText('имеющий герб')).toBeNull();
  expect(mocks.repair).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  invalidateDataScope();
  await act(async () => {
    resolve('всё');
  });
  expect(mocks.repair).not.toHaveBeenCalled();
});

test('AI proposals require acceptance and a stale proposal cannot overwrite a revised card', async () => {
  mocks.enabled = true;
  mocks.ai.mockResolvedValue('смутное подозрение');
  const original = saved({
    kind: 'phrase',
    id: 'phrase:sneaking suspicion',
    front: 'sneaking suspicion',
    back: 'подкрадываться к подозрениям',
    contextSentence: 'I had a sneaking suspicion.',
  });
  const { rerender } = render(
    <ReviewCard card={original} onAdvance={advance} onSkip={skip} />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  await userEvent.click(
    screen.getByRole('button', { name: 'Translate in context · AI' })
  );
  await screen.findByText('смутное подозрение');
  expect(mocks.edit).not.toHaveBeenCalled();
  rerender(
    <ReviewCard
      card={{ ...original, back: 'закралось подозрение' }}
      onAdvance={advance}
      onSkip={skip}
    />
  );
  mocks.edit.mockResolvedValue(false);
  await userEvent.click(
    screen.getByRole('button', { name: 'Use this meaning' })
  );
  expect(mocks.edit.mock.calls[0]?.[0]?.back).toBe(
    'подкрадываться к подозрениям'
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The card changed'
  );
});

test('a failed manual save keeps the editor and its input', async () => {
  mocks.edit.mockRejectedValue(new Error('Disk unavailable'));
  render(
    <ReviewCard
      card={saved({ back: 'гербовый' })}
      onAdvance={advance}
      onSkip={skip}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Edit answer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  expect(
    screen.getByRole('textbox', { name: 'General translation' })
  ).toHaveValue('гербовый');
});
