import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ChapterMatching } from './ChapterMatching';
import { matchingRounds, playableTerms } from './chapter-matching';

afterEach(cleanup);

test('every playable term occurs once, with no singleton final round', () => {
  for (let n = 2; n <= 30; n++) {
    const terms = Array.from({ length: n }, (_, i) => ({ id: String(i), front: `word${i}`, answer: `перевод${i}` }));
    const rounds = matchingRounds(terms);
    expect(rounds.flat().map((t) => t.id).sort()).toEqual(terms.map((t) => t.id).sort());
    expect(rounds.every((round) => round.length >= 2 && round.length <= 5)).toBe(true);
  }
  expect(playableTerms([{ id: 'a', front: 'word' }, { id: 'b', front: 'Word', answer: 'слово' }, { id: 'c', front: 'word', answer: 'другое' }])).toHaveLength(1);
});

test('wrong pairs can retry; identical translations accept either stable-id option', async () => {
  const terms = [{ id: 'a', front: 'shore', answer: 'берег' }, { id: 'b', front: 'bank', answer: ' БЕРЕГ ' }, { id: 'c', front: 'river', answer: 'река' }];
  render(<ChapterMatching terms={terms} onExit={vi.fn()} />);
  const left = within(screen.getByRole('group', { name: 'English words' }));
  const right = within(screen.getByRole('group', { name: 'Translations' }));
  await userEvent.click(left.getByRole('button', { name: 'shore' }));
  await userEvent.click(right.getByRole('button', { name: 'река' }));
  expect(screen.getByRole('status')).toHaveTextContent('Not a match');
  await userEvent.click(right.getByRole('button', { name: 'БЕРЕГ' }));
  expect(screen.getByRole('status')).toHaveTextContent('Correct');
  await userEvent.click(left.getByRole('button', { name: 'bank' }));
  await userEvent.click(right.getByRole('button', { name: /^берег$/ }));
  await userEvent.click(left.getByRole('button', { name: 'river' }));
  await userEvent.click(right.getByRole('button', { name: 'река' }));
  await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
  expect(screen.getByRole('status')).toHaveTextContent('Practice complete. Pairs: 3');
  expect(screen.getByRole('status')).toHaveFocus();
});

test('next round restores keyboard focus to an English option', async () => {
  const terms = Array.from({ length: 6 }, (_, i) => ({ id: String(i), front: `word${i}`, answer: `перевод${i}` }));
  render(<ChapterMatching terms={terms} onExit={vi.fn()} />);
  const left = within(screen.getByRole('group', { name: 'English words' }));
  const words = left.getAllByRole('button').map((button) => button.textContent!);
  for (const word of words) {
    await userEvent.click(left.getByRole('button', { name: word }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Translations' })).getByRole('button', { name: `перевод${word.slice(4)}` }));
  }
  const next = screen.getByRole('button', { name: 'Next round' });
  next.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(screen.getByRole('group', { name: 'English words' })).toContainElement(document.activeElement as HTMLElement));
});

test('native button keyboard activation selects and matches', async () => {
  render(<ChapterMatching terms={[{ id: 'a', front: 'one', answer: 'один' }, { id: 'b', front: 'two', answer: 'два' }]} onExit={vi.fn()} />);
  screen.getByRole('button', { name: 'one' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'one' })).toHaveAttribute('aria-pressed', 'true');
  screen.getByRole('button', { name: 'один' }).focus();
  await userEvent.keyboard(' ');
  expect(screen.getByRole('status')).toHaveTextContent('Correct');
});
