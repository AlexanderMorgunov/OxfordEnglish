import Dexie, { type EntityTable } from 'dexie';
import type { Card } from 'ts-fsrs';

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

export interface WordTranslation {
  word: string;
  ru: string;
  source: string;
}

export interface SrsCard {
  id: string;
  kind: 'word' | 'phrase' | 'grammar-pattern';
  front: string;
  back: string;
  contextSentence?: string;
  sourceDayId?: string;
  tags: string[];
  fromError?: boolean;
  due: Date;
  card: Card;
}

export interface CheckpointResult {
  id?: number;
  unitId: string;
  timestamp: number;
  score: number;
  total: number;
  tagBreakdown: { tag: string; correct: number; total: number }[];
}

const db = new Dexie('oxford-english') as Dexie & {
  attempts: EntityTable<ExerciseAttempt, 'id'>;
  wordStatus: EntityTable<WordStatus, 'word'>;
  srsCards: EntityTable<SrsCard, 'id'>;
  checkpoints: EntityTable<CheckpointResult, 'id'>;
  translations: EntityTable<WordTranslation, 'word'>;
};

db.version(1).stores({
  attempts: '++id, exerciseId, timestamp, *tags',
  wordStatus: 'word, status',
  srsCards: 'id, due, *tags',
  checkpoints: '++id, unitId, timestamp',
  translations: 'word',
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
