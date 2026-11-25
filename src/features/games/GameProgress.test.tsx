import 'fake-indexeddb/auto';
import { render, screen, cleanup } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { recordLearning, type GameScope } from './storage';
import { GameProgress } from './GameProgress';
vi.mock('@/features/account/store', () => ({
  localDataOwner: () => 'test',
  captureAccountSessionOwner: () => () => true,
}));
const scope: GameScope = { owner: 'test', check() {} };
beforeEach(async () => {
  await db.gameRecords.clear();
});
it('does not call a later attempt a correct first answer or count a replay as a new activity', async () => {
  const base = {
    activityId: 'one',
    itemVersion: '1',
    runId: 'run-1',
    attemptNumber: 2,
    skills: ['grammar.past-vs-continuous'],
    correct: true,
    usedHint: false,
    usedAI: false,
  };
  await recordLearning(scope, 'test', {
    ...base,
    eventId: crypto.randomUUID(),
  });
  render(<GameProgress />);
  expect(
    await screen.findByText(/1 activities · 0 correct first answers/)
  ).toBeInTheDocument();
  cleanup();
  await recordLearning(scope, 'test', {
    ...base,
    activityId: 'two',
    attemptNumber: 1,
    correct: false,
    eventId: crypto.randomUUID(),
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
  await recordLearning(scope, 'test', {
    ...base,
    activityId: 'two',
    attemptNumber: 1,
    runId: 'run-2',
    eventId: crypto.randomUUID(),
  });
  render(<GameProgress />);
  expect(
    await screen.findByText(/2 activities · 0 correct first answers/)
  ).toBeInTheDocument();
});
