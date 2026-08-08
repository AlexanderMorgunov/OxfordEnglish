import type { ExerciseAttempt } from '@/db/db';
import { currentStreak, skillMap } from './metrics';

const at = (
  exerciseId: string,
  tags: string[],
  correct: boolean,
  attemptNumber: number,
  timestamp: number
): ExerciseAttempt => ({
  exerciseId,
  tags,
  correct,
  attemptNumber,
  timestamp,
  userAnswer: '',
  usedHint: false,
  usedAI: false,
});

test('skillMap scores first attempts per tag, weakest first', () => {
  const attempts = [
    at('e1', ['grammar.past-simple'], false, 1, 0),
    at('e1', ['grammar.past-simple'], true, 2, 0), // retry ignored
    at('e2', ['grammar.past-simple'], true, 1, 0),
    at('e3', ['vocab.dev'], true, 1, 0),
  ];
  const map = skillMap(attempts);
  expect(map[0]).toMatchObject({ tag: 'grammar.past-simple', correct: 1, total: 2 });
  expect(map[0]?.accuracy).toBe(0.5);
  expect(map[1]).toMatchObject({ tag: 'vocab.dev', accuracy: 1 });
});

test('currentStreak counts consecutive days ending today', () => {
  const DAY = 86_400_000;
  const now = new Date('2026-08-09T12:00:00Z');
  const t = now.getTime();
  const attempts = [
    at('a', ['x'], true, 1, t),
    at('b', ['x'], true, 1, t - DAY),
    at('c', ['x'], true, 1, t - 2 * DAY),
    at('d', ['x'], true, 1, t - 5 * DAY), // gap breaks it
  ];
  expect(currentStreak(attempts, now)).toBe(3);
  expect(currentStreak([], now)).toBe(0);
});
