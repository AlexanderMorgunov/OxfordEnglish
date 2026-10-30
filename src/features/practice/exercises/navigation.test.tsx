import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Exercise } from '@/content/schema';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAiStore } from '@/features/ai/store';
import { explainError, hint } from '@/features/ai/functions';
import { createSessionResults, useSessionResults } from '@/features/progress/sessionResults';
import { ExerciseSessionContext } from './session';
import { OrderWordsExercise } from './OrderWordsExercise';
import { ChoiceExercise } from './ChoiceExercise';
import { GapFillExercise } from './GapFillExercise';
import { MatchExercise } from './MatchExercise';

vi.mock('@/features/ai/functions', () => ({ explainError: vi.fn(), hint: vi.fn() }));

const choice: Extract<Exercise, { type: 'choice' }> = {
  type: 'choice', id: 'navigation.choice', instruction: { en: 'Choose a word.' },
  tags: ['grammar.past-simple.question'], prompt: '___ you fix it?',
  options: ['Did', 'Do', 'Was'], correctIndex: 0,
};
const gap: Extract<Exercise, { type: 'gap-fill' }> = {
  type: 'gap-fill', id: 'navigation.gap', instruction: { en: 'Complete the sentence.' },
  tags: ['grammar.past-simple.regular'], prompt: 'Yesterday I ___ the app.', answers: ['deployed'],
};
const options = () => screen.getAllByRole('button', { name: /^\d\./ }).map(button => button.textContent);

beforeEach(() => {
  invalidateDataScope();
  useSessionResults.getState().reset([choice.id, gap.id]);
  useAiStore.setState({ config: null });
  vi.mocked(explainError).mockReset().mockResolvedValue('Use did for a past question.');
  vi.mocked(hint).mockReset().mockResolvedValue('Notice the tense.');
});
afterEach(cleanup);

test('a detour preserves the chosen answer, option order and AI explanation context', async () => {
  const first = render(<ChoiceExercise exercise={choice} />, { wrapper: MemoryRouter });
  const order = options();
  await userEvent.click(screen.getByRole('button', { name: /\d\. Was$/ }));
  first.unmount();

  useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture', model: 'fixture', baseUrl: 'https://fixture.invalid' } });
  render(<ChoiceExercise exercise={choice} />, { wrapper: MemoryRouter });
  expect(screen.getByRole('button', { name: /\d\. Was$/ })).toHaveClass('opt--wrong');
  expect(options()).toEqual(order);
  await userEvent.click(screen.getByRole('button', { name: 'why is it wrong? (AI)' }));
  await waitFor(() => expect(explainError).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    userAnswer: 'Was', attempts: ['Was'],
  })));
});

test('an unfinished written answer survives a detour but redo clears it', () => {
  const first = render(<GapFillExercise exercise={gap} />, { wrapper: MemoryRouter });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'deploy' } });
  first.unmount();
  const second = render(<GapFillExercise exercise={gap} />, { wrapper: MemoryRouter });
  expect(screen.getByRole('textbox')).toHaveValue('deploy');
  second.unmount();
  act(() => useSessionResults.getState().reset([gap.id]));
  render(<GapFillExercise exercise={gap} />, { wrapper: MemoryRouter });
  expect(screen.getByRole('textbox')).toHaveValue('');
});

test('an account handover cannot restore an unmounted exercise draft', () => {
  const first = render(<GapFillExercise exercise={gap} />, { wrapper: MemoryRouter });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private answer' } });
  first.unmount();
  invalidateDataScope();
  render(<GapFillExercise exercise={gap} />, { wrapper: MemoryRouter });
  expect(screen.getByRole('textbox')).toHaveValue('');
});

test('word order preserves a partially built answer and resets for another data owner', async () => {
  const exercise: Extract<Exercise, { type: 'order-words' }> = {
    type: 'order-words', id: 'navigation.order', instruction: { en: 'Put in order.' }, tags: [],
    tokens: ['I', 'like', 'tea'], correctOrder: [0, 1, 2],
  };
  const first = render(<OrderWordsExercise exercise={exercise} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'I' }));
  first.unmount();
  render(<OrderWordsExercise exercise={exercise} />, { wrapper: MemoryRouter });
  expect(screen.getByRole('button', { name: 'I' })).toBeDisabled();
  act(() => invalidateDataScope());
  expect(screen.getByRole('button', { name: 'I' })).not.toBeDisabled();
});

test('checkpoint sessions isolate answers and cannot rehydrate a previous owner', () => {
  const checkpoint = createSessionResults();
  const ui = <ExerciseSessionContext value={checkpoint}><GapFillExercise exercise={gap} /></ExerciseSessionContext>;
  const first = render(ui, { wrapper: MemoryRouter });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Checkpoint draft' } });
  first.unmount();
  const lesson = render(<GapFillExercise exercise={gap} />, { wrapper: MemoryRouter });
  expect(screen.getByRole('textbox')).toHaveValue('');
  lesson.unmount();
  invalidateDataScope();
  render(ui, { wrapper: MemoryRouter });
  expect(screen.getByRole('textbox')).toHaveValue('');
});

test('first signup keeps a checkpoint draft and allows further editing under the new scope', () => {
  const checkpoint = createSessionResults();
  render(<ExerciseSessionContext value={checkpoint}><GapFillExercise exercise={gap} /></ExerciseSessionContext>, { wrapper: MemoryRouter });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My checkpoint answer' } });
  act(() => invalidateDataScope('adopt-anonymous'));
  expect(screen.getByRole('textbox')).toHaveValue('My checkpoint answer');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My corrected answer' } });
  expect(screen.getByRole('textbox')).toHaveValue('My corrected answer');
});

test('a detour does not replenish the exercise AI hint allowance', async () => {
  useAiStore.setState({ config: { provider: 'custom', apiKey: 'fixture', model: 'fixture', baseUrl: 'https://fixture.invalid' } });
  const first = render(<ChoiceExercise exercise={choice} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: /\d\. Was$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'hint (AI) · 5' }));
  await screen.findByText('Notice the tense.');
  first.unmount();
  render(<ChoiceExercise exercise={choice} />, { wrapper: MemoryRouter });
  expect(screen.getByRole('button', { name: 'hint (AI) · 4' })).toBeEnabled();
});

test('a partially matched exercise keeps its pairs across a detour', async () => {
  const exercise: Extract<Exercise, { type: 'match' }> = {
    type: 'match', id: 'navigation.match', instruction: { en: 'Match pairs.' }, tags: [],
    pairs: [{ left: 'cat', right: 'кот' }, { left: 'dog', right: 'собака' }],
  };
  const first = render(<MatchExercise exercise={exercise} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByRole('button', { name: 'cat' }));
  await userEvent.click(screen.getByRole('button', { name: 'кот' }));
  first.unmount();
  render(<MatchExercise exercise={exercise} />, { wrapper: MemoryRouter });
  expect(screen.getByRole('button', { name: /cat.*кот/ })).toBeVisible();
  expect(screen.getByRole('button', { name: 'кот' })).toBeDisabled();
});
