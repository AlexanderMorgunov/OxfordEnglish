import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import * as service from '@/features/srs/service';
import { ReviewPage } from './ReviewPage';
import { track } from '@/features/analytics/analytics';
vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));

vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/vocab/lemma', () => ({ useLemma: () => ({ byForm: new Map(), lemmas: new Set(['go']) }), baseForm: () => null, isFormOf: (word: string, term: string) => word === term }));
vi.mock('@/features/vocab/cefr', () => ({ useCefr: () => new Map(), cefrOf: () => null }));
vi.mock('@/features/vocab/usePartOfSpeech', () => ({ usePartOfSpeech: () => new Map([['go', ['verb']]]) }));
vi.mock('@/features/ai/route', () => ({ useAiEnabled: () => false, useAiUnknown: () => false }));

const seed = async (front: string): Promise<SrsCard> => {
  const schedule = createEmptyCard(new Date(0));
  const row: SrsCard = { id: `word:${front}`, kind: 'word', front, back: front === 'go' ? 'идти' : 'оставаться', tags: [], due: schedule.due, card: schedule, createdAt: 1, creationId: front };
  await db.srsCards.put(row);
  return row;
};
const grade = async (rating: 'easy' | 'again' | 'good') => {
  await userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  const previous = JSON.stringify(await db.reviewLog.toArray());
  await userEvent.click(screen.getByRole('button', { name: rating }));
  await waitFor(async () => expect(JSON.stringify(await db.reviewLog.toArray())).not.toBe(previous));
};
beforeEach(async () => {
  vi.mocked(track).mockClear();
  await db.open();
  await Promise.all([db.srsCards.clear(), db.reviewLog.clear(), db.wordStatus.clear(), db.pending.clear()]);
  await seed('go');
});
afterEach(() => { vi.restoreAllMocks(); });

test('next-card and completion entry replace the original rating without another repetition', async () => {
  await seed('stay');
  render(<ReviewPage />, { wrapper: MemoryRouter });
  expect(await screen.findByText('verb')).toBeInTheDocument();
  expect(screen.getByText('to go')).toBeInTheDocument();
  await grade('easy');
  expect(await screen.findByText('stay')).toBeInTheDocument();
  const before = await db.srsCards.get('word:go');
  const previousEvent = (await db.reviewLog.toArray())[0];
  await userEvent.click(await screen.findByRole('button', { name: 'Change last rating' }));
  expect(await screen.findByText('Changing the last rating')).toBeInTheDocument();
  expect(screen.getByText('Previous rating: easy')).toBeInTheDocument();
  expect(await db.srsCards.get('word:go')).toEqual(before);
  await grade('again');
  expect(await screen.findByText('stay')).toBeInTheDocument();
  expect(screen.queryByText('Changing the last rating')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect((await db.srsCards.get('word:go'))?.card.reps).toBe(1);
  expect(await db.reviewLog.toArray()).toHaveLength(1);
  expect((await db.reviewLog.toArray())[0]).toMatchObject({ id: previousEvent?.id, ts: previousEvent?.ts, rating: 1 });
  await grade('good');
  expect(await screen.findByText('✓ session finished')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Change last rating' }));
  expect(await screen.findByText('stay')).toBeInTheDocument();
  await grade('again');
  expect(await screen.findByText('✓ session finished')).toBeInTheDocument();
  expect(await db.reviewLog.count()).toBe(2);
  expect((await db.srsCards.get('word:stay'))?.card.reps).toBe(1);
  expect(vi.mocked(track).mock.calls.filter(([event]) => event === 'review_session_completed')).toEqual([['review_session_completed']]);
});

test('an empty or all-skipped queue emits no review completion', async () => {
  const view = render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));
  await screen.findByText('Session finished · skipped: 1');
  expect(track).not.toHaveBeenCalled();
  view.unmount(); await db.srsCards.clear();
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await screen.findByText('✓ session finished');
  expect(track).not.toHaveBeenCalled();
});

test('cancelling correction resumes ordinary review and leaves the old grade committed', async () => {
  await seed('stay');
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await grade('easy');
  const schedule = await db.srsCards.get('word:go');
  const log = await db.reviewLog.toArray();
  await userEvent.click(await screen.findByRole('button', { name: 'Change last rating' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Continue without changes' }));
  expect(await screen.findByText('stay')).toBeInTheDocument();
  expect(await db.srsCards.get('word:go')).toEqual(schedule);
  expect(await db.reviewLog.toArray()).toEqual(log);
});

test('owner handover clears the receipt and correction prompt', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await grade('easy');
  await userEvent.click(await screen.findByRole('button', { name: 'Change last rating' }));
  await screen.findByText('Changing the last rating');
  await act(async () => { invalidateDataScope(); await db.srsCards.clear(); await seed('stay'); });
  expect(await screen.findByText('stay')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Change last rating' })).toBeNull();
  expect(screen.queryByText('Changing the last rating')).toBeNull();
});

test('a changed or removed last card is never revived by the recovery control', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await grade('easy');
  await act(async () => { await db.srsCards.update('word:go', { deletedAt: Date.now() + 1000 }); });
  await userEvent.click(await screen.findByRole('button', { name: 'Change last rating' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The previous card changed');
  expect(screen.queryByText('Changing the last rating')).toBeNull();
  expect(await db.reviewLog.count()).toBe(1);
});

test('ordinary grading is disabled while the previous card is being opened', async () => {
  await seed('stay');
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await grade('easy');
  await userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  let finish!: (value: SrsCard | null) => void;
  const gate = new Promise<SrsCard | null>(resolve => { finish = resolve; });
  vi.spyOn(service, 'reviewCorrectionCard').mockImplementationOnce(() => gate);
  await userEvent.click(screen.getByRole('button', { name: 'Change last rating' }));
  expect(screen.getByRole('button', { name: 'good' })).toBeDisabled();
  expect(await db.reviewLog.count()).toBe(1);
  await act(async () => { finish((await db.srsCards.get('word:go'))!); });
  expect(await screen.findByText('Changing the last rating')).toBeInTheDocument();
});

test('correction follows an edited answer and keyboard activation keeps a valid focus target', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await grade('easy');
  const button = await screen.findByRole('button', { name: 'Change last rating' });
  await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Session finished'));
  button.focus();
  await userEvent.keyboard('{Enter}');
  await screen.findByText('Changing the last rating');
  await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Current card'));
  await act(async () => { await db.srsCards.update('word:go', { back: 'двигаться' }); });
  await userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  expect(await screen.findByText('двигаться')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'again' }));
  await screen.findByText('✓ session finished');
  await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-label', 'Session finished'));
});
