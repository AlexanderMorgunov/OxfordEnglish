import { test, expect } from 'vitest';
import { retentionDay } from './analytics';

const DAY = 86_400_000;

test('retentionDay is 0 on the first day', () => {
  const seen = 1_700_000_000_000;
  expect(retentionDay(seen, seen)).toBe(0);
  expect(retentionDay(seen + DAY - 1, seen)).toBe(0);
});

test('retentionDay counts whole days since first launch', () => {
  const seen = 1_700_000_000_000;
  expect(retentionDay(seen + DAY, seen)).toBe(1);
  expect(retentionDay(seen + 7 * DAY + 5000, seen)).toBe(7);
});

test('retentionDay never goes negative on a clock skew', () => {
  const seen = 1_700_000_000_000;
  expect(retentionDay(seen - DAY, seen)).toBe(0);
});
