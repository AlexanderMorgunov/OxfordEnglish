import Dexie, { type EntityTable } from 'dexie';
import type { Card } from 'ts-fsrs';

/** Sync metadata (slice 2). Optional until the write-through layer (slice 2d) stamps every new write;
 *  the v7 migration backfills existing rows from their natural creation time (never `now()` — F11).
 *  `updatedBy` is the install id (see syncState), NOT the account deviceId (which is not stable across
 *  device-linking). Rows count as deleted iff `deletedAt >= updatedAt` (H1). */
export interface SyncMetaFields {
  updatedAt?: number;
  updatedBy?: string;
  deletedAt?: number;
}

/** Low sentinel for backfilled `updatedAt` when a row has no natural creation timestamp — ancient enough
 *  that a real server value always wins the first-reconcile LWW race (never 0/`now()`/a future `due`). */
export const EPOCH_SENTINEL = 1;

export interface ExerciseAttempt extends SyncMetaFields {
  id?: number;
  /** Globally-unique sync identity (`installId:localId`); the local `++id` stays device-private. */
  syncId?: string;
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

export interface WordStatus extends SyncMetaFields {
  word: string;
  status: WordStatusValue;
  firstSeenAt: number;
  encounters: number;
  /** Separate clock for `status` LWW (F6) — distinct from `updatedAt`, which tracks any field change. */
  statusUpdatedAt?: number;
}

export interface WordTranslation {
  word: string;
  ru: string;
  source: string;
}

export interface SrsCard extends SyncMetaFields {
  id: string;
  kind: 'word' | 'phrase' | 'grammar-pattern';
  front: string;
  back: string;
  contextSentence?: string;
  /** The word's meaning in its source sentence (from the AI in-context lookup), when saved from the
   *  reader — distinct from `back` (the general dictionary translation). Non-indexed: no version bump. */
  contextGloss?: string;
  sourceDayId?: string;
  tags: string[];
  fromError?: boolean;
  due: Date;
  card: Card;
}

export interface CheckpointResult extends SyncMetaFields {
  id?: number;
  syncId?: string;
  unitId: string;
  timestamp: number;
  score: number;
  total: number;
  tagBreakdown: { tag: string; correct: number; total: number }[];
}

/** A user-imported book. The file itself lives in OPFS; this is only its metadata. */
export interface BookRecord extends SyncMetaFields {
  id: string;
  title: string;
  author?: string;
  format: 'epub' | 'fb2' | 'docx' | 'pdf';
  addedAt: number;
  chapterCount: number;
  /** Reading position: last chapter index opened. */
  lastChapter: number;
}

/** A reader bookmark. Anchored to content (page + paragraph index + a text snippet), not pixels,
 *  so it survives font-size changes and reflow. `scrollY` is a cosmetic fallback only. */
export interface Bookmark extends SyncMetaFields {
  id: string;
  /** = the reader's idPrefix: `reader.<uuid>` (imported) or `reader.catalog.<slug>` (catalog). */
  bookKey: string;
  page: number;
  paragraph: number;
  /** `chapters[page].id` — resolves the page even if pagination shifts later indices. */
  pageId: string;
  scrollY?: number;
  snippet: string;
  chapterTitle?: string;
  createdAt: number;
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

/** The synced "settings" tier — the learner level/placement + reader/AI/i18n prefs that today live in
 *  Zustand's hand-rolled localStorage persist (F9). The v7 table exists now; bridging the actual stores
 *  into it is slice 2d, so it may be empty until then. LWW `(updatedAt, updatedBy)`. */
export interface SettingRecord extends SyncMetaFields {
  key: string;
  value: unknown;
}

/** Per-account sync bookkeeping + the one install-global row (`account: '__install__'`) that owns the
 *  stable install id. Deliberately holds NO tokens (the account store owns those). */
export interface SyncStateRecord {
  account: string;
  /** Only on the `__install__` row: this browser's stable sync identity (the LWW `updatedBy`). */
  installId?: string;
  /** Per-account pull cursor — highest contiguous changelog seq applied (F1). */
  cursorSeq?: number;
}

/** The install-global syncState row key (distinct from any real accountId). */
export const INSTALL_ROW = '__install__';

/** A dirty marker: a synced row awaiting push. Keyed on the SYNC identity (`syncId` for the append-only
 *  stores, the domain PK otherwise) so the engine sends the right `Change.id` without a second guess and
 *  the marker survives re-reads. Deduped by `key` (put overwrites). */
export interface PendingChange {
  key: string;
  store: string;
  /** The domain primary key (local `++id` string / word / bookKey…) used to re-read the row. */
  id: string;
  /** Present for append-only stores (attempts/checkpoints) — the value sent as `Change.id`. */
  syncId?: string;
}

const db = new Dexie('oxford-english') as Dexie & {
  attempts: EntityTable<ExerciseAttempt, 'id'>;
  wordStatus: EntityTable<WordStatus, 'word'>;
  srsCards: EntityTable<SrsCard, 'id'>;
  checkpoints: EntityTable<CheckpointResult, 'id'>;
  translations: EntityTable<WordTranslation, 'word'>;
  books: EntityTable<BookRecord, 'id'>;
  bookmarks: EntityTable<Bookmark, 'id'>;
  catalogCache: EntityTable<CatalogCacheEntry, 'id'>;
  analyticsQueue: EntityTable<AnalyticsEvent, 'id'>;
  feedbackOutbox: EntityTable<FeedbackOutboxItem, 'id'>;
  settings: EntityTable<SettingRecord, 'key'>;
  syncState: EntityTable<SyncStateRecord, 'account'>;
  pending: EntityTable<PendingChange, 'key'>;
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

db.version(6).stores({
  bookmarks: 'id, bookKey, createdAt, [bookKey+page+paragraph]',
});

/** v7 (slice 2): sync scaffolding. Adds sync-meta indexes + a globally-unique `&syncId` for the
 *  append-only stores (kept alongside the private `++id` — Dexie can't change a primary key in an
 *  upgrade), the synced `settings` tier table, and `syncState`. The upgrade backfills every existing
 *  row's `updatedAt`/`statusUpdatedAt` from its natural creation time (F11), stamps a fresh install id,
 *  and never uses `now()`. */
db.version(7)
  .stores({
    attempts: '++id, exerciseId, timestamp, *tags, &syncId, updatedAt',
    wordStatus: 'word, status, statusUpdatedAt, updatedAt',
    srsCards: 'id, due, *tags, updatedAt, deletedAt',
    checkpoints: '++id, unitId, timestamp, &syncId, updatedAt',
    books: 'id, addedAt, updatedAt',
    bookmarks: 'id, bookKey, createdAt, [bookKey+page+paragraph], updatedAt',
    settings: 'key, updatedAt',
    syncState: 'account',
    pending: 'key',
  })
  .upgrade(async (tx) => {
    const installId = crypto.randomUUID();
    await tx.table('syncState').put({ account: INSTALL_ROW, installId });
    await tx.table('attempts').toCollection().modify((r: ExerciseAttempt) => {
      r.updatedBy = installId;
      r.updatedAt = r.timestamp ?? EPOCH_SENTINEL;
      r.syncId = `${installId}:a${r.id ?? ''}`;
    });
    await tx.table('checkpoints').toCollection().modify((r: CheckpointResult) => {
      r.updatedBy = installId;
      r.updatedAt = r.timestamp ?? EPOCH_SENTINEL;
      r.syncId = `${installId}:c${r.id ?? ''}`;
    });
    await tx.table('wordStatus').toCollection().modify((r: WordStatus) => {
      r.updatedBy = installId;
      r.statusUpdatedAt = r.firstSeenAt ?? EPOCH_SENTINEL;
      r.updatedAt = r.firstSeenAt ?? EPOCH_SENTINEL;
    });
    await tx.table('srsCards').toCollection().modify((r: SrsCard) => {
      r.updatedBy = installId;
      r.updatedAt = r.card?.last_review ? new Date(r.card.last_review).getTime() : EPOCH_SENTINEL;
    });
    await tx.table('books').toCollection().modify((r: BookRecord) => {
      r.updatedBy = installId;
      r.updatedAt = r.addedAt ?? EPOCH_SENTINEL;
    });
    await tx.table('bookmarks').toCollection().modify((r: Bookmark) => {
      r.updatedBy = installId;
      r.updatedAt = r.createdAt ?? EPOCH_SENTINEL;
    });
  });

export { db };
