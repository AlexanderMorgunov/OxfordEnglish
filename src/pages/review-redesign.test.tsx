import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { Dexie } from 'dexie';
import { db } from '@/db/db';
import type { SrsCard } from '@/db/db';
import { installDialogMock } from '@/test/dialog';
import { invalidateDataScope } from '@/features/account/dataScope';
import * as service from '@/features/srs/service';
import { useReviewSession } from '@/features/srs/review-session';
import { ReviewPage } from './ReviewPage';

const mocks = vi.hoisted(() => ({
  ai: vi.fn(),
  translate: vi.fn(),
  enabled: true,
}));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({
  useSpeechAvailable: () => false,
}));
vi.mock('@/features/vocab/lemma', () => ({
  useLemma: () => ({ byForm: new Map(), lemmas: new Set() }),
  baseForm: () => null,
  isFormOf: (word: string, term: string) => word === term,
}));
vi.mock('@/features/vocab/cefr', () => ({
  useCefr: () => new Map(),
  cefrOf: () => ({ level: 1, order: 1 }),
  CEFR_LEVELS: ['A1', 'A2', 'B1', 'B2'],
}));
vi.mock('@/features/ai/route', () => ({
  useAiEnabled: () => mocks.enabled,
  useAiUnknown: () => false,
  AI_REQUEST_TIMEOUT: 30000,
}));
vi.mock('@/features/ai/functions', () => ({ aiTranslate: mocks.ai }));
vi.mock('@/features/vocab/translate', async (original) => ({
  ...(await original<object>()),
  translateWord: mocks.translate,
  translateText: mocks.translate,
}));

const seed = async (front = 'journey', over: Partial<SrsCard> = {}) => {
  const card = createEmptyCard(new Date(0));
  await db.srsCards.put({
    id: `word:${front}`,
    kind: 'word',
    front,
    back: 'путешествие',
    contextSentence: `A ${front} is worth the effort.`,
    tags: [],
    due: card.due,
    card,
    creationId: front,
    ...over,
  });
};
const start = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Start review' }));
const reveal = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
const edit = async () => {
  await userEvent.click(screen.getByText('About this answer and card'));
  await userEvent.click(screen.getByRole('button', { name: 'Edit answer' }));
};
beforeEach(async () => {
  installDialogMock();
  useReviewSession.setState({ session: null });
  mocks.enabled = true;
  mocks.ai.mockReset().mockResolvedValue('дорога');
  mocks.translate.mockReset().mockResolvedValue(null);
  await db.open();
  await Promise.all([
    db.srsCards.clear(),
    db.wordStatus.clear(),
    db.reviewLog.clear(),
    db.pending.clear(),
    db.translations.clear(),
  ]);
  await seed();
});
afterEach(() => vi.restoreAllMocks());

test('overview does not reveal or grade and usefulness remains visible after reveal', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await screen.findByRole('button', { name: 'Start review' });
  expect(screen.queryByRole('button', { name: /^Good:/ })).toBeNull();
  expect(await db.reviewLog.count()).toBe(0);
  await start();
  expect(
    screen.getByRole('img', { name: /CEFR usefulness: 4 of 5, A2/ })
  ).toBeInTheDocument();
  await reveal();
  expect(
    screen.getByRole('img', { name: /CEFR usefulness: 4 of 5, A2/ })
  ).toBeInTheDocument();
});
test('pause, component departure and resume retain the open answer and committed history', async () => {
  const view = render(<ReviewPage />, { wrapper: MemoryRouter });
  await start();
  await reveal();
  await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(
    await screen.findByRole('button', { name: 'Resume session' })
  ).toBeInTheDocument();
  view.unmount();
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Resume session' })
  );
  expect(await screen.findByRole('button', { name: /^Good:/ })).toBeEnabled();
  expect(await db.reviewLog.count()).toBe(0);
  await userEvent.click(screen.getByRole('button', { name: /^Good:/ }));
  await screen.findByRole('heading', { name: 'Session finished' });
  expect(await db.reviewLog.count()).toBe(1);
});
test('keyboard cannot grade a hidden answer or hijack a control or editor', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await start();
  await userEvent.keyboard('3');
  expect(await db.reviewLog.count()).toBe(0);
  document.body.focus();
  await userEvent.keyboard('[Space]');
  await screen.findByRole('button', { name: /^Good:/ });
  await edit();
  const field = screen.getByRole('textbox', { name: 'General translation' });
  await userEvent.type(field, '1234');
  expect(await db.reviewLog.count()).toBe(0);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await db.reviewLog.count()).toBe(0);
});
test('failed grade preserves the current answer; retry and double activation make one review', async () => {
  const original = service.gradeCardWithReceipt;
  const spy = vi
    .spyOn(service, 'gradeCardWithReceipt')
    .mockRejectedValueOnce(new Error('disk full'));
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await start();
  await reveal();
  await userEvent.click(screen.getByRole('button', { name: /^Good:/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not record'
  );
  expect(await db.reviewLog.count()).toBe(0);
  spy.mockImplementation(original);
  await userEvent.dblClick(
    screen.getByRole('button', { name: 'Retry saving rating' })
  );
  await screen.findByRole('heading', { name: 'Session finished' });
  expect(await db.reviewLog.count()).toBe(1);
});
test('lookup failure prevents rating, while a manual answer saves without AI', async () => {
  await seed('journey', { back: 'journey' });
  mocks.enabled = false;
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await start();
  await reveal();
  await screen.findByText(/Translation unavailable/);
  expect(screen.getByRole('button', { name: /^Good:/ })).toBeDisabled();
  await edit();
  expect(
    screen.getByRole('button', { name: 'Translate in context · AI' })
  ).toBeDisabled();
  expect(screen.getByRole('link', { name: 'DayEnglish Pro' })).toHaveAttribute(
    'href',
    '/pro'
  );
  await userEvent.type(
    screen.getByRole('textbox', { name: 'General translation' }),
    'дорога'
  );
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('дорога')).toBeInTheDocument();
  expect((await db.srsCards.get('word:journey'))?.card.reps).toBe(0);
});
test('AI suggestion and applying it only edit a draft until explicit Save', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await start();
  await reveal();
  await edit();
  await userEvent.click(
    screen.getByRole('button', { name: 'Translate in context · AI' })
  );
  await screen.findByText('дорога');
  expect((await db.srsCards.get('word:journey'))?.contextGloss).toBeUndefined();
  await userEvent.click(
    screen.getByRole('button', { name: 'Use this meaning' })
  );
  expect(
    screen.getByRole('textbox', { name: 'Meaning in context' })
  ).toHaveValue('дорога');
  expect((await db.srsCards.get('word:journey'))?.contextGloss).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await db.srsCards.get('word:journey'))?.contextGloss).toBe('дорога');
  expect(await db.reviewLog.count()).toBe(0);
});
test('cancelled and superseded AI replies cannot change an editor draft', async () => {
  let finish!: (text: string) => void;
  mocks.ai.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await start();
  await reveal();
  await edit();
  await userEvent.click(
    screen.getByRole('button', { name: 'Translate in context · AI' })
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Cancel AI request' })
  );
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Meaning in context' }),
    'свой ответ'
  );
  await act(async () => finish('поздний ответ'));
  expect(screen.queryByText('поздний ответ')).toBeNull();
  expect(
    screen.getByRole('textbox', { name: 'Meaning in context' })
  ).toHaveValue('свой ответ');
});
test('strict read failure is not an empty queue and can be retried', async () => {
  vi.spyOn(db.srsCards, 'toArray').mockRejectedValueOnce(
    new Error('unavailable')
  );
  render(<ReviewPage />, { wrapper: MemoryRouter });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not load the queue'
  );
  expect(screen.queryByText('Nothing due right now')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByRole('button', { name: 'Start review' });
});
test('cancelling a slow read ignores its late result and permits a new attempt', async () => {
  let finish!: (rows: SrsCard[]) => void;
  vi.spyOn(db.srsCards, 'toArray').mockImplementationOnce(
    () =>
      new Dexie.Promise<SrsCard[]>((resolve) => {
        finish = resolve;
      })
  );
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Cancel loading' })
  );
  await act(async () => finish([]));
  expect(screen.queryByText('Your words will appear here')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByRole('button', { name: 'Start review' });
});
test('scope handover closes a private editor and discards pending AI replies', async () => {
  let finish!: (text: string) => void;
  mocks.ai.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await start();
  await reveal();
  await edit();
  await userEvent.click(
    screen.getByRole('button', { name: 'Translate in context · AI' })
  );
  await act(async () => {
    invalidateDataScope();
    await db.srsCards.clear();
    await seed('new-owner');
  });
  await act(async () => finish('прежний аккаунт'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('прежний аккаунт')).toBeNull();
  expect(useReviewSession.getState().session).toBeNull();
  await screen.findByRole('button', { name: 'Start review' });
});
test('an in-flight committed grade is retained in the session even after leaving the page', async () => {
  const original = service.gradeCardWithReceipt;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(service, 'gradeCardWithReceipt').mockImplementation(
    async (...args) => {
      await gate;
      return original(...args);
    }
  );
  const view = render(<ReviewPage />, { wrapper: MemoryRouter });
  await start();
  await reveal();
  await userEvent.click(screen.getByRole('button', { name: /^Good:/ }));
  view.unmount();
  await act(async () => finish());
  await waitFor(async () => expect(await db.reviewLog.count()).toBe(1));
  expect(useReviewSession.getState().session?.receipts).toHaveLength(1);
});
