import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Exercise } from '@/content/schema';
import { GapFillExercise } from './GapFillExercise';
import { ChoiceExercise } from './ChoiceExercise';

// Exercises render an AiUpsellLink (<Link>) when no AI key is set, so they need a router context.
const renderR = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

const gap: Extract<Exercise, { type: 'gap-fill' }> = {
  type: 'gap-fill',
  id: 'ex.gap',
  instruction: { en: 'Type the past form.' },
  tags: ['grammar.past-simple.regular'],
  prompt: 'Yesterday I ___ the app.',
  cue: '(deploy)',
  answers: ['deployed'],
};

const choice: Extract<Exercise, { type: 'choice' }> = {
  type: 'choice',
  id: 'ex.choice',
  instruction: { en: 'Pick the right word.' },
  tags: ['grammar.past-simple.question'],
  prompt: '___ you fix it?',
  options: ['Did', 'Do', 'Was'],
  correctIndex: 0,
};

test('gap-fill allows retry after a wrong answer, then passes', async () => {
  const onSolved = vi.fn();
  renderR(<GapFillExercise exercise={gap} onSolved={onSolved} />);
  const input = screen.getByPlaceholderText(/your answer/i);

  await userEvent.type(input, 'deploy');
  await userEvent.click(screen.getByRole('button', { name: /run check/i }));
  expect(screen.getByText(/assertion failed/i)).toBeInTheDocument();
  expect(onSolved).not.toHaveBeenCalled();
  expect(input).not.toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, 'Deployed');
  await userEvent.click(screen.getByRole('button', { name: /run check/i }));
  expect(screen.getByText(/test passed/i)).toBeInTheDocument();
  expect(onSolved).toHaveBeenCalledOnce();
});

test('choice can be answered with the number key', async () => {
  const onSolved = vi.fn();
  renderR(<ChoiceExercise exercise={choice} onSolved={onSolved} />);
  await userEvent.click(screen.getByRole('button', { name: /1\. Did/ }));
  expect(screen.getByText(/correct answer: Did/)).toBeInTheDocument();
  expect(onSolved).toHaveBeenCalledOnce();
});
