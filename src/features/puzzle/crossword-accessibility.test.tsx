import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { useUiLang } from '@/features/i18n/uiLang';
import { CrosswordView } from './CrosswordView';
import type { Crossword } from './generate';

const crossword: Crossword = { cols: 3, rows: 1, grid: [['C', 'A', 'T']], dropped: 0, placed: [
  { number: 1, word: 'CAT', clue: 'кошка', row: 0, col: 0, dir: 'across' },
] };
afterEach(() => { cleanup(); useUiLang.setState({ lang: 'en' }); });

test('the clue labels its input, feedback is announced and Enter submits', async () => {
  useUiLang.setState({ lang: 'ru' });
  render(<CrosswordView crossword={crossword} />);
  const field = screen.getByRole('textbox', { name: '1. кошка' });
  await userEvent.type(field, 'dog{Enter}');
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('status')).toHaveTextContent('Попробуйте ещё раз');
  await userEvent.clear(field);
  await userEvent.type(field, 'cat');
  await userEvent.click(screen.getByRole('button', { name: 'Проверить 1: кошка' }));
  expect(screen.getAllByRole('status').some(e => e.textContent?.includes('cat'))).toBe(true);
  expect(screen.getByText('Готово — все слова! ✓')).toBeInTheDocument();
});

test('separate crossword instances have unique native label associations', () => {
  render(<><CrosswordView crossword={crossword} /><CrosswordView crossword={crossword} /></>);
  const fields = screen.getAllByRole('textbox', { name: '1. кошка' });
  expect(fields).toHaveLength(2);
  expect(fields[0]?.id).not.toBe(fields[1]?.id);
  expect(screen.getAllByText('across')).toHaveLength(2);
});
