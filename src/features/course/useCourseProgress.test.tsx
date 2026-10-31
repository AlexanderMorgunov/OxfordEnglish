import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import type { ExerciseAttempt } from '@/db/db';
import { courseAttempt } from '@/test/courseFixture';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useCourseProgress } from './useCourseProgress';

vi.mock('@/features/srs/service', () => ({
  getDueCards: vi.fn(async () => []),
}));

beforeEach(async () => {
  await db.attempts.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('updates live when an answer arrives, without reload', async () => {
  const { result } = renderHook(useCourseProgress);
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.attempts).toEqual([]);
  await act(async () => {
    await db.attempts.add(courseAttempt('day.e1', false));
  });
  await waitFor(() => expect(result.current.attempts).toHaveLength(1));
  expect(result.current.attempts[0]?.correct).toBe(false);
});

test('a failed database read is distinct from an empty history and can be retried', async () => {
  const read = vi
    .spyOn(db.attempts, 'toArray')
    .mockRejectedValueOnce(new Error('Storage unavailable'));
  const { result } = renderHook(useCourseProgress);
  await waitFor(() => expect(result.current.status).toBe('error'));
  read.mockRestore();
  await db.attempts.add(courseAttempt('day.e1'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.attempts[0]?.exerciseId).toBe('day.e1');
});

test('a late read from the previous account cannot replace the new account progress', async () => {
  let finish!: (attempts: ExerciseAttempt[]) => void;
  const pending = new Dexie.Promise<ExerciseAttempt[]>((resolve) => {
    finish = resolve;
  });
  const read = vi
    .spyOn(db.attempts, 'toArray')
    .mockReturnValueOnce(pending)
    .mockResolvedValue([]);
  const { result } = renderHook(useCourseProgress);
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  act(() => invalidateDataScope('reset'));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  await act(async () => finish([courseAttempt('previous-account.e1')]));
  expect(result.current.attempts).toEqual([]);
});

test('a stalled read eventually leaves the course browsable and can recover late', async () => {
  let finish!: (attempts: ExerciseAttempt[]) => void;
  const read = vi.spyOn(db.attempts, 'toArray').mockReturnValue(
    new Dexie.Promise<ExerciseAttempt[]>((resolve) => {
      finish = resolve;
    })
  );
  const { result } = renderHook(useCourseProgress);
  await waitFor(() => expect(read).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 8100));
  });
  expect(result.current.status).toBe('error');
  await act(async () => finish([courseAttempt('day.e1')]));
  await waitFor(() => expect(result.current.status).toBe('ready'));
}, 10000);
