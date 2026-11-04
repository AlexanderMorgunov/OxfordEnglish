import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ExerciseAttempt } from '@/db/db';
import type { LoadedPack } from '@/content/loader';
import { useContentStore } from '@/content/store';
import { invalidateDataScope } from '@/features/account/dataScope';
import { ProgressPage } from '@/pages/ProgressPage';
import { emptyDay } from '@/features/stats/accounting';
import { useProgressView } from './view';

const mocks = vi.hoisted(() => ({
  attempts: vi.fn(),
  vocab: vi.fn(),
  history: vi.fn(),
  activity: vi.fn(),
  since: vi.fn(),
}));
vi.mock('./queries', () => ({
  loadAttempts: mocks.attempts,
  vocabSize: mocks.vocab,
  checkpointHistory: mocks.history,
}));
vi.mock('@/features/stats/activity', () => ({
  loadActivity: mocks.activity,
  statsSince: mocks.since,
}));
const title = { en: 'A real topic', ru: 'Тема' };
const pack: LoadedPack = {
  manifest: {
    id: 'test',
    name: title,
    version: '1',
    level: 'A1',
    visibility: 'public',
    license: { type: 'original', attribution: 'Authors' },
    attributions: [],
  },
  course: {
    id: 'test',
    title,
    level: 'A1',
    license: { type: 'original', attribution: 'Authors' },
    units: [],
  },
  units: [],
  days: new Map(),
  grammar: [
    {
      id: 'past-simple',
      title: { en: 'Past Simple', ru: 'Past Simple' },
      summary: title,
      blocks: [{ text: title }],
    },
  ],
};
const now = new Date('2026-10-31T12:00:00Z').getTime();
const attempt = (
  id: string,
  correct: boolean,
  number = 1
): ExerciseAttempt => ({
  exerciseId: id,
  tags: ['grammar.past-simple'],
  correct,
  attemptNumber: number,
  timestamp: now - 1000,
  userAnswer: 'x',
  usedHint: false,
  usedAI: false,
});
const row = {
  ...emptyDay('today:a', '2026-10-31'),
  readSec: 60,
  readWords: 100,
  wordsSaved: 2,
  phrasesSaved: 1,
  books: { book: { title: 'Real book', sec: 60, words: 100, saved: 3 } },
};
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/progress']}>
      <ProgressPage />
    </MemoryRouter>
  );

test('malformed legacy checkpoint data is unavailable rather than crashing the page', async () => {
  mocks.history.mockResolvedValue(
    JSON.parse('[{"unitId":42,"timestamp":1793448000000,"score":0,"total":0}]')
  );
  renderPage();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not load: checkpoints'
  );
  expect(
    screen.getByRole('heading', { name: 'Your progress' })
  ).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { name: 'Your story starts here' })
  ).toBeInTheDocument();
});
const originalLoad = useContentStore.getState().load;
const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'showModal'
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  'close'
);
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
  mocks.attempts.mockReset().mockResolvedValue([]);
  mocks.vocab.mockReset().mockResolvedValue(7);
  mocks.history.mockReset().mockResolvedValue([]);
  mocks.activity.mockReset().mockResolvedValue({ rows: [], reviews: [] });
  mocks.since.mockReset().mockResolvedValue(null);
  useProgressView.setState({
    period: 'week',
    filter: 'all',
    expanded: false,
    bar: '',
    anchor: null,
  });
  useContentStore.setState({ status: 'ready', pack, load: async () => {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useContentStore.setState({ load: originalLoad });
  if (originalShowModal)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      'showModal',
      originalShowModal
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose)
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

test('first use has genuine empty states and fourteen named UTC practice dates', async () => {
  renderPage();
  await screen.findByRole('heading', { name: 'Your story starts here' });
  expect(
    screen.getByRole('heading', { name: 'Results appear after practice' })
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByRole('list', { name: 'Exercise activity' })
    ).getAllByRole('listitem')
  ).toHaveLength(14);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mocks.attempts).toHaveBeenCalledWith({ strict: true });
});

test('period changes affect reading, while first attempts and lifetime totals remain honest', async () => {
  mocks.attempts.mockResolvedValue([
    attempt('one', false),
    attempt('one', true, 2),
    attempt('two', true),
  ]);
  mocks.activity.mockResolvedValue({
    rows: [row],
    reviews: [
      { ts: now, rating: 3 },
      { ts: now, rating: 1 },
    ],
  });
  mocks.since.mockResolvedValue('2026-10-01');
  const { container } = renderPage();
  await screen.findByRole('button', { name: 'Review: Past Simple' });
  expect(screen.getByText(/1 of 2 first answers correct/)).toBeInTheDocument();
  expect(container.querySelector('[data-reading-total]')).toHaveTextContent(
    '1 min'
  );
  expect(screen.getByText('100 words read · 3 saves')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-seconds="0"]')).toHaveLength(6);
  expect(container.querySelector('[data-seconds="0"]')).toHaveStyle({
    '--bar-height': '0%',
  });
  await userEvent.click(screen.getByRole('button', { name: '30 days' }));
  expect(container.querySelectorAll('.pr-bar')).toHaveLength(30);
  expect(screen.getByText(/1 of 2 first answers correct/)).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Review: Past Simple' })
  );
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/sample is small/i)).toBeInTheDocument();
  expect(
    within(dialog).getByRole('link', { name: 'Open rule' })
  ).toHaveAttribute('href', '/grammar/past-simple?from=progress');
  await userEvent.click(
    within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!
  );
  expect(
    screen.getByRole('button', { name: 'Review: Past Simple' })
  ).toHaveFocus();
});

test('a reading error is unknown, supports cancelling and cannot overwrite a successful retry', async () => {
  mocks.attempts.mockResolvedValue([attempt('one', false)]);
  mocks.activity.mockRejectedValueOnce(new Error('DB unavailable'));
  renderPage();
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: 'Review: Past Simple' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Your story starts here' })
  ).not.toBeInTheDocument();
  let finish = (_data: { rows: (typeof row)[]; reviews: [] }) => {};
  mocks.activity.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await userEvent.click(screen.getByRole('button', { name: '30 days' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel loading' }));
  mocks.activity.mockResolvedValue({ rows: [row], reviews: [] });
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByText('100 words read · 3 saves');
  await act(async () => finish({ rows: [], reviews: [] }));
  expect(screen.getByText('100 words read · 3 saves')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('account handover resets filters and rejects in-flight results from the previous owner', async () => {
  let finish = (_data: ExerciseAttempt[]) => {};
  mocks.attempts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  useProgressView.setState({ period: 'month', filter: 'grammar' });
  renderPage();
  await waitFor(() => expect(mocks.attempts).toHaveBeenCalledTimes(1));
  mocks.attempts.mockResolvedValue([]);
  act(() => invalidateDataScope());
  await screen.findByRole('heading', { name: 'Results appear after practice' });
  await act(async () => finish([attempt('old-owner', true)]));
  expect(
    screen.queryByRole('button', { name: 'Review: Past Simple' })
  ).not.toBeInTheDocument();
  expect(useProgressView.getState()).toMatchObject({
    period: 'week',
    filter: 'all',
    anchor: null,
  });
});

test('removed and zero-total checkpoints keep their history without offering a broken retake', async () => {
  mocks.history.mockResolvedValue([
    {
      id: 9,
      unitId: 'removed-unit',
      timestamp: now,
      score: 0,
      total: 0,
      tagBreakdown: [],
    },
  ]);
  renderPage();
  await userEvent.click(
    await screen.findByRole('button', { name: /removed-unit/ })
  );
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByText(/unavailable in the current course/)
  ).toBeInTheDocument();
  expect(
    within(dialog).queryByRole('link', { name: 'Retake checkpoint' })
  ).not.toBeInTheDocument();
  expect(within(dialog).getByText('—')).toBeInTheDocument();
});

test('offline and failed exercise history do not erase available vocabulary or reading', async () => {
  mocks.attempts.mockRejectedValue(new Error('attempts unavailable'));
  mocks.activity.mockResolvedValue({ rows: [row], reviews: [] });
  renderPage();
  await screen.findByRole('alert');
  expect(
    await screen.findByText('100 words read · 3 saves')
  ).toBeInTheDocument();
  expect(
    screen.getByText('Exercise results are currently unknown.')
  ).toBeInTheDocument();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  fireEvent(window, new Event('offline'));
  expect(screen.getByText(/You are offline/)).toBeInTheDocument();
});
