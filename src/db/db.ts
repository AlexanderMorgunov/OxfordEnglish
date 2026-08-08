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

export type WordStatusValue = 'unknown' | 'learning' | 'known' | 'ignored';

export interface WordStatus {
  word: string;
  status: WordStatusValue;
  firstSeenAt: number;
  encounters: number;
}

const db = new Dexie('oxford-english') as Dexie & {
  attempts: EntityTable<ExerciseAttempt, 'id'>;
  wordStatus: EntityTable<WordStatus, 'word'>;
};

db.version(1).stores({
  attempts: '++id, exerciseId, timestamp, *tags',
  wordStatus: 'word, status',
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
