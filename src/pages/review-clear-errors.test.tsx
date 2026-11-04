import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import { installDialogMock } from '@/test/dialog';
import { useReviewSession } from '@/features/srs/review-session';
import { isDeleted } from '@/features/sync/resolve';
import { ReviewPage } from './ReviewPage';

vi.mock('@/shared/lib/useSpeechAvailable', () => ({
  useSpeechAvailable: () => false,
}));
const seed = async (count: number) => {
  const card = createEmptyCard(new Date(0));
  await db.srsCards.bulkPut(
    Array.from({ length: count }, (_, i) => ({
      id: `err:${i}`,
      kind: 'phrase' as const,
      front: 'It is ___ . (she)',
      back: 'hers',
      tags: [],
      fromError: true,
      due: card.due,
      card,
    }))
  );
};
beforeEach(async () => {
  installDialogMock();
  useReviewSession.setState({ session: null });
  await db.open();
  await Promise.all([
    db.srsCards.clear(),
    db.wordStatus.clear(),
    db.pending.clear(),
  ]);
});
test('a mistake card can be removed before revealing, with confirmation', async () => {
  await seed(1);
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Start review' })
  );
  expect(
    screen.getByRole('button', { name: 'Show answer' })
  ).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove from review' })
  );
  expect(isDeleted((await db.srsCards.get('err:0'))!)).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(isDeleted((await db.srsCards.get('err:0'))!)).toBe(false);
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove from review' })
  );
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await screen.findByRole('heading', { name: 'Session finished' });
  expect(isDeleted((await db.srsCards.get('err:0'))!)).toBe(true);
});
test('maintenance stays hidden below twenty mistakes', async () => {
  await seed(19);
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await screen.findByRole('button', { name: 'Start review' });
  expect(screen.queryByText(/Cards from previous mistakes/)).toBeNull();
});
test('maintenance states the real count and preserves vocabulary when confirmed', async () => {
  await seed(21);
  const card = createEmptyCard(new Date(0));
  await db.srsCards.put({
    id: 'word:quiet',
    kind: 'word',
    front: 'quiet',
    back: 'тихий',
    tags: [],
    due: card.due,
    card,
  });
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(
    await screen.findByText('Cards from previous mistakes · 21')
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove all old mistake cards' })
  );
  expect(screen.getByRole('dialog')).toHaveTextContent('cannot be undone');
  expect((await db.srsCards.toArray()).filter(isDeleted)).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await screen.findByRole('button', { name: 'Start review' });
  expect((await db.srsCards.toArray()).filter(isDeleted)).toHaveLength(21);
  expect(isDeleted((await db.srsCards.get('word:quiet'))!)).toBe(false);
});
test('cancelling bulk removal leaves every old card unchanged', async () => {
  await seed(20);
  const before = await db.srsCards.toArray();
  render(<ReviewPage />, { wrapper: MemoryRouter });
  await userEvent.click(
    await screen.findByText('Cards from previous mistakes · 20')
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Remove all old mistake cards' })
  );
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await db.srsCards.toArray()).toEqual(before);
});
