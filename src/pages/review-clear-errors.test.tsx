/**
 * Both controls exist because the pile got to 321 cards. The per-card one was there already but lived
 * behind "Show answer", which asks someone to work through a card in order to say they do not want it;
 * the bulk one is new and deliberately hidden until the pile is past what anyone would clear by hand.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { Rating } from 'ts-fsrs';
import type { SrsCard } from '@/db/db';

const due = new Date(Date.now() - 86_400_000);
let queue: SrsCard[] = [];
let errorCount = 0;
const dropAll = vi.fn(async () => errorCount);

const card = (id: string, over: Partial<SrsCard> = {}): SrsCard =>
  ({
    id,
    kind: 'phrase',
    front: 'It is ___ . (she)',
    back: 'hers',
    tags: [],
    fromError: true,
    due,
    card: {},
    updatedAt: 1,
    updatedBy: 'i',
    ...over,
  }) as SrsCard;

vi.mock('@/features/srs/service', () => ({
  Rating,
  canPronounce: () => false,
  getDueCards: async () => queue,
  countErrorCards: async () => errorCount,
  dropAllErrorCards: () => dropAll(),
  dropCard: vi.fn(async () => undefined),
  gradeCard: vi.fn(async () => undefined),
  repairCardBack: vi.fn(async () => false),
}));
vi.mock('@/features/vocab/translate', () => ({ translateText: async () => null, translateWord: async () => null }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/shared/lib/audio', () => ({ speakWord: vi.fn() }));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));

const { ReviewPage } = await import('./ReviewPage');

const REMOVE_ONE = /убрать из повторения|remove from review/i;
const REMOVE_ALL = /убрать все карточки из ошибок|remove all mistake cards/i;

beforeEach(() => {
  queue = [card('err:1')];
  errorCount = 0;
  dropAll.mockClear();
});

test('a mistake card can be left without answering it first', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });

  // Before any reveal — the whole point.
  expect(await screen.findByText(REMOVE_ONE)).toBeInTheDocument();
  expect(screen.getByText(/показать ответ|show answer/i)).toBeInTheDocument();
});

test('bulk removal stays hidden while the pile is small enough to clear by hand', async () => {
  errorCount = 19;
  render(<ReviewPage />, { wrapper: MemoryRouter });

  await screen.findByText(REMOVE_ONE);
  expect(screen.queryByText(REMOVE_ALL)).toBeNull();
});

test('bulk removal appears once the pile is past that, and states the count', async () => {
  errorCount = 321;
  render(<ReviewPage />, { wrapper: MemoryRouter });

  expect(await screen.findByText(/321/)).toBeInTheDocument();
});

test('bulk removal asks before it takes three hundred cards away', async () => {
  errorCount = 321;
  render(<ReviewPage />, { wrapper: MemoryRouter });

  await userEvent.click(await screen.findByText(REMOVE_ALL));

  // Still nothing removed: the first click only asks.
  expect(dropAll).not.toHaveBeenCalled();
  expect(screen.getByText(/отменить будет нельзя|cannot be undone/i)).toBeInTheDocument();

  await userEvent.click(screen.getByText(/^убрать$|^remove$/i));

  expect(dropAll).toHaveBeenCalledOnce();
});

test('cancelling leaves the pile alone', async () => {
  errorCount = 321;
  render(<ReviewPage />, { wrapper: MemoryRouter });

  await userEvent.click(await screen.findByText(REMOVE_ALL));
  await userEvent.click(screen.getByText(/отмена|cancel/i));

  expect(dropAll).not.toHaveBeenCalled();
  expect(screen.getByText(REMOVE_ALL)).toBeInTheDocument();
});
