import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Exercise } from '@/content/schema';
import { db } from '@/db/db';
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

// Options are shuffled per mount, so tests must find them by text, never by position.
const optionButton = (text: string) =>
  screen.getByRole('button', { name: new RegExp(`\\d\\. ${text}$`) });

test('choice passes when the authored answer is picked, wherever it is shown', async () => {
  const onSolved = vi.fn();
  renderR(<ChoiceExercise exercise={choice} onSolved={onSolved} />);
  await userEvent.click(optionButton('Did'));
  expect(screen.getByText(/correct answer: Did/)).toBeInTheDocument();
  expect(onSolved).toHaveBeenCalledOnce();
});

// A solved outcome is remembered per exercise id in the session-results store, which outlives a
// remount — so each test needs its own id, or the next one starts already "correct".
test('choice rejects a wrong option even when it is shown first', async () => {
  const onSolved = vi.fn();
  renderR(<ChoiceExercise exercise={{ ...choice, id: 'ex.choice.reject' }} onSolved={onSolved} />);
  await userEvent.click(optionButton('Was'));
  expect(screen.getByText(/not quite/i)).toBeInTheDocument();
  expect(onSolved).not.toHaveBeenCalled();
});

test('choice does not always render the authored answer first', () => {
  const seen = new Set<string>();
  for (let run = 0; run < 40; run++) {
    const { unmount } = renderR(
      <ChoiceExercise exercise={{ ...choice, id: `ex.choice.order.${run}` }} onSolved={vi.fn()} />
    );
    seen.add(screen.getByRole('button', { name: /^1\./ }).textContent ?? '');
    unmount();
  }
  expect(seen.size).toBeGreaterThan(1);
});

/**
 * A wrong answer used to create a review card. It no longer does, and this is where that is pinned.
 *
 * The queue is what the learner chose to keep, and a gap-fill prompt lifted out of its exercise
 * ("Give it to ___ .") cannot be answered there anyway. Mistakes are still recorded — `addAttempt`
 * runs either way, which is where every statistic about them comes from.
 */
// A fresh id per test: attempt outcomes live in a module-level store that outlives a test, so reusing
// `ex.gap` starts this one already answered and `submit` returns before it can do anything.
const freshGap = (id: string) => ({ ...gap, id });

test('a wrong answer creates no review card and claims none', async () => {
  const user = userEvent.setup();
  renderR(<GapFillExercise exercise={freshGap('ex.gap.wrong')} />);

  await user.type(screen.getByRole('textbox'), 'deploys');
  await user.click(screen.getByRole('button', { name: /run check/i }));

  // Marked wrong, so the attempt was processed and this is not a test that simply did nothing.
  expect(await screen.findByText(/try again/i)).toBeInTheDocument();
  expect(screen.queryByText(/added to your review queue|добавлено в повторение/i)).not.toBeInTheDocument();
  expect(await db.srsCards.count()).toBe(0);
});

test('a right answer creates none either', async () => {
  const user = userEvent.setup();
  renderR(<GapFillExercise exercise={freshGap('ex.gap.right')} />);

  await user.type(screen.getByRole('textbox'), 'deployed');
  await user.click(screen.getByRole('button', { name: /run check/i }));

  expect(screen.queryByText(/added to your review queue|добавлено в повторение/i)).not.toBeInTheDocument();
  expect(await db.srsCards.count()).toBe(0);
});
