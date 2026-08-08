import Dexie, { type EntityTable } from 'dexie';

export interface ExerciseAttempt {
  id?: number;
  exerciseId: string;
  tags: string[];
  correct: boolean;
  userAnswer: string;
  attemptNumber: number;
  timestamp: number;
  usedHint: boolean;
  usedAI: boolean;
}

const db = new Dexie('oxford-english') as Dexie & {
  attempts: EntityTable<ExerciseAttempt, 'id'>;
};

db.version(1).stores({
  attempts: '++id, exerciseId, timestamp, *tags',
});

export { db };

/** Best-effort — analytics must never block the UI or throw where IndexedDB is absent. */
export async function recordAttempt(
  attempt: Omit<ExerciseAttempt, 'id'>
): Promise<void> {
  try {
    await db.attempts.add(attempt);
  } catch {
    // no-op: attempts are non-critical telemetry
  }
}
