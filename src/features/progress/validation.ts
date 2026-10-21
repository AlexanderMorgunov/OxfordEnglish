import { z } from 'zod';
import type { ExerciseAttempt } from '@/db/db';

export const validTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime());

export const validDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const counter = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const attemptSchema = z.object({
  exerciseId: z.string().min(1),
  tags: z.array(z.string()),
  correct: z.boolean(),
  userAnswer: z.string(),
  attemptNumber: z.number().int().positive(),
  timestamp: z.number().refine(validTimestamp),
  usedHint: z.boolean(),
  usedAI: z.boolean(),
}).passthrough();

const countSchema = z.number().finite().nonnegative();
const bookSchema = z.object({ title: z.string(), sec: countSchema, words: countSchema, saved: countSchema }).passthrough();
const activitySchema = z.object({
  id: z.string().min(1), day: z.string().refine(validDay),
  readSec: countSchema, readWords: countSchema, wordsSaved: countSchema,
  phrasesSaved: countSchema, learned: countSchema,
  books: z.record(bookSchema).default({}),
}).passthrough();

export function validateAttempts(value: unknown): ExerciseAttempt[] {
  const parsed = z.array(attemptSchema).safeParse(value === undefined ? [] : value);
  if (!parsed.success) throw new Error('Invalid exercise history');
  return parsed.data;
}

export function validateActivity(value: unknown) {
  const parsed = z.array(activitySchema).safeParse(value === undefined ? [] : value);
  if (!parsed.success) throw new Error('Invalid reading history');
  return parsed.data;
}
