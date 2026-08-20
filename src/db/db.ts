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

/** A user-imported book. The file itself lives in OPFS; this is only its metadata. */
export interface BookRecord {
  id: string;
  title: string;
  author?: string;
  format: 'epub' | 'fb2' | 'docx' | 'pdf';
  addedAt: number;
  chapterCount: number;
  /** Reading position: last chapter index opened. */
  lastChapter: number;
}

/** A remote catalog book fetched once and kept for offline rereading. `book` is a ParsedBook. */
export interface CatalogCacheEntry {
  id: string;
  book: unknown;
  cachedAt: number;
}

/** One queued anonymous analytics event, awaiting a flush to the ingestion endpoint. */
export interface AnalyticsEvent {
  id?: number;
  event: string;
  props?: Record<string, string | number | boolean>;
  ts: number;
}

/** A user-composed feedback message awaiting delivery (kept so it survives an offline submit). */
export interface FeedbackOutboxItem {
  id?: number;
  body: Record<string, string | number | boolean>;
  createdAt: number;
}

const db = new Dexie('oxford-english') as Dexie & {
  attempts: EntityTable<ExerciseAttempt, 'id'>;
  wordStatus: EntityTable<WordStatus, 'word'>;
  srsCards: EntityTable<SrsCard, 'id'>;
  checkpoints: EntityTable<CheckpointResult, 'id'>;
  translations: EntityTable<WordTranslation, 'word'>;
  books: EntityTable<BookRecord, 'id'>;
  catalogCache: EntityTable<CatalogCacheEntry, 'id'>;
  analyticsQueue: EntityTable<AnalyticsEvent, 'id'>;
  feedbackOutbox: EntityTable<FeedbackOutboxItem, 'id'>;
};

db.version(1).stores({
  attempts: '++id, exerciseId, timestamp, *tags',
  wordStatus: 'word, status',
  srsCards: 'id, due, *tags',
  checkpoints: '++id, unitId, timestamp',
  translations: 'word',
});

db.version(2).stores({
  books: 'id, addedAt',
});

db.version(3).stores({
  catalogCache: 'id, cachedAt',
});

db.version(4).stores({
  analyticsQueue: '++id, ts',
});

db.version(5).stores({
  feedbackOutbox: '++id, createdAt',
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
