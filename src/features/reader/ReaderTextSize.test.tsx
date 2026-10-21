import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { useUiLang } from '@/features/i18n/uiLang';
import { ReaderTextSize } from './ReaderTextSize';
import { ReadingText } from './reading-text';
import { useReaderSettings } from './settings';

vi.mock('@/features/sync/local', () => ({ stampSetting: vi.fn(async () => {}) }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('./difficulty', async original => ({ ...(await original<object>()), loadFreq: async () => null }));
vi.mock('@/features/vocab/lemma', async original => ({ ...(await original<object>()), useLemma: () => ({ byForm: new Map(), lemmas: new Set() }) }));
vi.mock('@/features/vocab/cefr', async original => ({ ...(await original<object>()), useCefr: () => new Map() }));

beforeEach(() => {
  useUiLang.setState({ lang: 'en' });
  useReaderSettings.setState({ fontStep: 2, lineStep: 0, coloring: false });
});

test('size controls stay inside closed reading settings and are discoverable by their summary', () => {
  const { container } = render(<ReadingText paragraphs={['Alpha beta.']} />, { wrapper: MemoryRouter });
  const slider = screen.getByRole('slider', { name: 'Book text size' });
  expect(slider.closest('details')).not.toBeNull();
  expect(slider).not.toBeVisible();
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Reader settings')).toBeVisible();
});

test('buttons and slider change source text, announce the percentage, and retain token identities', async () => {
  const { container } = render(<ReadingText paragraphs={['Alpha beta.']} />, { wrapper: MemoryRouter });
  await userEvent.click(screen.getByText('Reader settings'));
  const before = [...container.querySelectorAll('[data-widx]')].map(e => e.getAttribute('data-widx'));
  await userEvent.click(screen.getByRole('button', { name: 'Larger' }));
  expect(screen.getByRole('slider')).toHaveValue('3');
  expect(screen.getByRole('status')).toHaveTextContent('106%');
  expect(container.querySelector('[data-para]')).toHaveClass('text-[1.125rem]');
  fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });
  expect(container.querySelector('[data-para]')).toHaveClass('text-[2.125rem]');
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '200%');
  expect(screen.getByRole('button', { name: 'Larger' })).toBeDisabled();
  expect([...container.querySelectorAll('[data-widx]')].map(e => e.getAttribute('data-widx'))).toEqual(before);
  expect(JSON.parse(localStorage.getItem('oxford-reader-settings')!)).toMatchObject({ fontStep: 12, fontScaleVersion: 2 });
  fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } });
  expect(screen.getByRole('button', { name: 'Smaller' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Larger' })).toBeEnabled();
  expect(screen.getByRole('status')).toHaveTextContent('88%');
});

test('several reader instances have separate labels and share the device preference', async () => {
  render(<><ReaderTextSize /><ReaderTextSize /></>);
  const sliders = screen.getAllByRole('slider', { name: 'Book text size' });
  expect(sliders[0]!.id).not.toBe(sliders[1]!.id);
  await userEvent.click(screen.getAllByRole('button', { name: 'Smaller' })[0]!);
  expect(sliders.every(slider => (slider as HTMLInputElement).value === '1')).toBe(true);
  act(() => useUiLang.setState({ lang: 'ru' }));
  expect(screen.getAllByRole('slider', { name: 'Размер текста книги' })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: 'Больше' })).toHaveLength(2);
});
