import type { ExerciseAttempt } from '@/db/db';

export type TagStat = { tag: string; correct: number; total: number; accuracy: number };

const dayKey = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** First attempt per exercise — the honest "did you know it" signal. */
function firstAttempts(attempts: ExerciseAttempt[]): ExerciseAttempt[] {
  const first = new Map<string, ExerciseAttempt>();
  for (const a of attempts) {
    const cur = first.get(a.exerciseId);
    if (!cur || a.attemptNumber < cur.attemptNumber) first.set(a.exerciseId, a);
  }
  return [...first.values()];
}

/** Accuracy per SkillTag from first attempts, weakest first (DESIGN_DOC §5.7). */
export function skillMap(attempts: ExerciseAttempt[]): TagStat[] {
  const stats = new Map<string, { correct: number; total: number }>();
  for (const a of firstAttempts(attempts)) {
    for (const tag of a.tags) {
      const s = stats.get(tag) ?? { correct: 0, total: 0 };
      s.total += 1;
      if (a.correct) s.correct += 1;
      stats.set(tag, s);
    }
  }
  return [...stats.entries()]
    .map(([tag, s]) => ({ tag, ...s, accuracy: s.total ? s.correct / s.total : 0 }))
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
}

export function activeDays(attempts: ExerciseAttempt[]): Set<string> {
  return new Set(attempts.map((a) => dayKey(a.timestamp)));
}

/** Consecutive days with activity ending today or yesterday. */
export function currentStreak(attempts: ExerciseAttempt[], now: Date): number {
  const days = activeDays(attempts);
  if (days.size === 0) return 0;
  const cursor = new Date(now);
  const key = () => cursor.toISOString().slice(0, 10);
  if (!days.has(key())) cursor.setUTCDate(cursor.getUTCDate() - 1);
  if (!days.has(key())) return 0;
  let streak = 0;
  while (days.has(key())) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
