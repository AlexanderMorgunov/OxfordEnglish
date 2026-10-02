import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';

vi.mock('@/shared/lib/useSpeechAvailable', () => ({ useSpeechAvailable: () => false }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/vocab/lemma', () => ({ useLemma: () => ({ byForm: new Map(), lemmas: new Set() }), baseForm: () => null, isFormOf: (word: string, term: string) => word === term }));
vi.mock('@/features/vocab/cefr', () => ({ useCefr: () => new Map(), cefrOf: () => null }));
vi.mock('@/features/ai/route', () => ({ useAiEnabled: () => false, useAiUnknown: () => false }));
const { ReviewPage } = await import('./ReviewPage');

beforeEach(async () => {
  await db.open();
  await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.pending.clear(), db.reviewLog.clear()]);
  const schedule = createEmptyCard(new Date(0));
  await db.srsCards.put({ id: 'word:all', kind: 'word', front: 'all', back: 'все', tags: [], due: schedule.due, card: schedule });
});

test('the open card follows incoming answer changes and is removed when ignored', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  expect(screen.getByText('все')).toBeInTheDocument();
  await act(async () => { await db.srsCards.update('word:all', { back: 'всё' }); });
  expect(await screen.findByText('всё')).toBeInTheDocument();
  await act(async () => { await db.wordStatus.put({ word: 'all', status: 'ignored', firstSeenAt: 1, encounters: 1 }); });
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Grade the card' })).toBeNull());
  expect(await db.reviewLog.count()).toBe(0);
});

test('skipping does not claim that everything was reviewed or change the schedule', async () => {
  const original = await db.srsCards.get('word:all');
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.getByText('Session finished · skipped: 1')).toBeInTheDocument();
  expect(await db.srsCards.get('word:all')).toEqual(original);
  expect(await db.reviewLog.count()).toBe(0);
  await userEvent.click(screen.getByRole('button', { name: 'Return to skipped cards' }));
  expect(screen.getByRole('button', { name: 'Show answer' })).toBeInTheDocument();
});

test('an ownership reset discards the previous session before displaying the new queue', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  await act(async () => {
    invalidateDataScope();
    await db.srsCards.clear();
    const schedule = createEmptyCard(new Date(0));
    await db.srsCards.put({ id: 'word:other', kind: 'word', front: 'other', back: 'другой', tags: [], due: schedule.due, card: schedule });
  });
  await screen.findByText('other');
  expect(screen.queryByText('все')).toBeNull();
  expect(screen.getByRole('button', { name: 'Show answer' })).toBeInTheDocument();
});

test('new cards wait for the next session without claiming that the entire due queue is empty', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await screen.findByRole('button', { name: 'Show answer' });
  await act(async () => {
    const schedule = createEmptyCard(new Date(0));
    await db.srsCards.put({ id: 'word:new', kind: 'word', front: 'new', back: 'новый', tags: [], due: schedule.due, card: schedule });
    await db.wordStatus.put({ word: 'all', status: 'ignored', firstSeenAt: 1, encounters: 1 });
  });
  expect(await screen.findByText('✓ session finished')).toBeInTheDocument();
  expect(screen.queryByText('new')).toBeNull();
  expect(screen.queryByText(/nothing due/)).toBeNull();
  expect(await db.reviewLog.count()).toBe(0);
});

test('a skipped card that becomes ignored no longer claims to remain due', async () => {
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Show answer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(screen.getByText('Session finished · skipped: 1')).toBeInTheDocument();
  await act(async () => {
    await db.wordStatus.put({ word: 'all', status: 'ignored', firstSeenAt: 1, encounters: 1 });
  });
  expect(await screen.findByText('✓ session finished')).toBeInTheDocument();
  expect(screen.queryByText('Skipped cards remain due. Their schedules have not changed.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Return to skipped cards' })).toBeNull();
  expect(await db.reviewLog.count()).toBe(0);
});
