import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAiStore } from '@/features/ai/store';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { ReadingText } from './reading-text';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn(() => new Promise(() => undefined)) }));
vi.mock('@/features/vocab/translate', () => ({ translateWord: lookup }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => true }));
vi.mock('@/features/stats/useReadingTracker', () => ({ saveProgress: vi.fn(), useReadingTracker: () => undefined }));
vi.mock('./ReaderWidget', () => ({ ReaderWidget: () => null }));

beforeEach(() => {
  lookup.mockClear();
  useAiStore.setState({ config: null });
  useUiLang.setState({ lang: 'ru' });
  useVocabStore.setState({ ready: true, statuses: new Map() });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ map: {}, levels: [], words: [] }))));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); useUiLang.setState({ lang: 'en' }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('RU word lookup names actions, loading, pronunciation and close in Russian; switching to EN updates them', async () => {
  render(<MemoryRouter><ReadingText paragraphs={['A quiet meadow.']} /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'meadow' }));
  const popup = screen.getByRole('dialog', { name: 'meadow' });
  expect(within(popup).getByRole('button', { name: 'учу' })).toBeInTheDocument();
  expect(within(popup).getByRole('button', { name: 'знаю' })).toBeInTheDocument();
  expect(within(popup).getByRole('button', { name: 'Произнести meadow' })).toBeInTheDocument();
  expect(within(popup).getByRole('status')).toHaveTextContent('перевод…');
  expect(within(popup).getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
  act(() => useUiLang.setState({ lang: 'en' }));
  expect(within(popup).getByRole('button', { name: 'learning' })).toBeInTheDocument();
  expect(within(popup).getByRole('button', { name: 'Pronounce meadow' })).toBeInTheDocument();
  await userEvent.click(within(popup).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
