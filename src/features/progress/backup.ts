import { db, type ActivityDay, type Bookmark, type ReviewLogEntry, type SrsCard, type SettingRecord } from '@/db/db';
import { mergeActivity } from '@/features/stats/accounting';
import { mergeReviewLog } from '@/features/stats/review-log';
import { reviveCard } from '@/features/srs/reviveCard';
import { stampImported, enqueueForPush, currentInstallId, isSyncing } from '@/features/sync/local';
import { triggerSync } from '@/features/sync/run';
import { READER_TERM_PREFIX, validatedReaderTermRows } from '@/features/reader/chapter-vocabulary';
import { captureDataScope, requireDataScope } from '@/features/account/dataScope';
import { markDirty } from '@/features/sync/engine';
import { resolveLww, type SyncMeta } from '@/features/sync/resolve';
import { validateActivity, validateAttempts } from './validation';

export { reviveCard };

export async function exportData(): Promise<string> {
  const current = captureDataScope();
  const [attempts, wordStatus, srsCards, checkpoints, translations, catalogCache, bookmarks, activity, reviewLog, sourceRows] =
    await Promise.all([
      db.attempts.toArray(),
      db.wordStatus.toArray(),
      db.srsCards.toArray(),
      db.checkpoints.toArray(),
      // Exclude reader lens caches (simplify/grammar): book-derived, regenerable, and can be large.
      db.translations.filter((t) => !t.source.startsWith('lens-')).toArray(),
      db.catalogCache.toArray(),
      db.bookmarks.toArray(),
      db.activity.toArray(),
      db.reviewLog.toArray(),
      db.settings.where('key').startsWith(READER_TERM_PREFIX).toArray(),
    ]);
  const readerTerms = await validatedReaderTermRows(sourceRows);
  requireDataScope(current);
  return JSON.stringify(
    {
      version: 4,
      exportedAt: Date.now(),
      attempts,
      wordStatus,
      srsCards,
      checkpoints,
      translations,
      // Self-contained offline catalog books (parsed JSON). `books` (imported files) is omitted:
      // the file itself lives in OPFS, not in this JSON, so restoring the index would list files
      // that aren't present.
      catalogCache,
      // Reader bookmarks. Only catalog bookmarks (stable keys) rematch after restore; imported-book
      // bookmarks (reader.<uuid>) become harmless orphans since a re-import mints a new id.
      bookmarks,
      activity,
      reviewLog,
      readerTerms,
    },
    null,
    2
  );
}


type Backup = {
  attempts?: unknown[];
  wordStatus?: unknown[];
  srsCards?: SrsCard[];
  checkpoints?: unknown[];
  translations?: unknown[];
  catalogCache?: unknown[];
  bookmarks?: Bookmark[];
  activity?: ActivityDay[];
  reviewLog?: ReviewLogEntry[];
  readerTerms?: unknown[];
};

/** Drop the autoincrement primary key so imported rows append instead of overwriting the target
 *  device's rows by a colliding id. */
export function stripId(rows: unknown[]): unknown[] {
  return rows.map((r) => {
    const { id: _id, ...rest } = r as { id?: number };
    return rest;
  });
}

export async function importData(json: string): Promise<void> {
  const current = captureDataScope();
  const data = JSON.parse(json) as Backup;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid backup');
  const tables = ['attempts', 'wordStatus', 'srsCards', 'checkpoints', 'translations', 'catalogCache', 'bookmarks', 'activity', 'reviewLog', 'readerTerms'] as const;
  for (const table of tables) {
    if (data[table] !== undefined && !Array.isArray(data[table])) throw new Error('Invalid backup');
  }
  const attempts = validateAttempts(data.attempts);
  const activity = validateActivity(data.activity);
  const readerTerms = await validatedReaderTermRows(Array.isArray(data.readerTerms) ? data.readerTerms : []);
  const iid = await currentInstallId(); // fetched before the tx (syncState is out of its table scope)
  const syncing = isSyncing();
  requireDataScope(current);
  await db.transaction(
    'rw',
    [
      db.attempts,
      db.wordStatus,
      db.srsCards,
      db.checkpoints,
      db.translations,
      db.catalogCache,
      db.bookmarks,
      db.activity,
      db.reviewLog,
      db.settings,
      db.pending,
    ],
    async () => {
      requireDataScope(current);
      // `++id` stores: append (a merge across devices), never bulkPut-by-id (which would clobber). Stamped
      // with a global syncId + meta so a later sync/reconcile treats them as distinct, sync-able rows.
      if (attempts.length) await db.attempts.bulkAdd(stampImported('attempts', stripId(attempts) as object[], iid) as never);
      if (data.checkpoints) await db.checkpoints.bulkAdd(stampImported('checkpoints', stripId(data.checkpoints) as object[], iid) as never);
      // Natural-key stores: merge by key (bookmarks carry an inbound string UUID — never stripId).
      if (data.wordStatus) await db.wordStatus.bulkPut(stampImported('wordStatus', data.wordStatus as object[], iid) as never);
      if (data.srsCards) await db.srsCards.bulkPut(stampImported('srsCards', data.srsCards.map(reviveCard), iid));
      if (data.translations) await db.translations.bulkPut(data.translations as never); // not synced
      if (data.catalogCache) await db.catalogCache.bulkPut(data.catalogCache as never); // not synced
      if (data.bookmarks) await db.bookmarks.bulkPut(stampImported('bookmarks', data.bookmarks, iid));
      // Per-device rows (id = day:installId): not in the sync set, so never stamped. Merged by max.
      for (const row of activity) {
        await db.activity.put(mergeActivity(await db.activity.get(row.id), row));
      }
      for (const incoming of data.reviewLog ?? []) {
        await db.reviewLog.put(mergeReviewLog(await db.reviewLog.get(incoming.id), incoming));
      }
      for (const incoming of stampImported('settings', readerTerms, iid)) {
        const existing = await db.settings.get(incoming.key);
        const row: SettingRecord = existing?.updatedAt != null && existing.updatedBy != null
          ? resolveLww(existing as SettingRecord & SyncMeta, incoming as SettingRecord & SyncMeta) : incoming;
        await db.settings.put(row);
        if (syncing) await markDirty('settings', { ...row });
      }
      await enqueueForPush(['attempts', 'checkpoints', 'wordStatus', 'srsCards', 'bookmarks']);
      requireDataScope(current);
    }
  );
  // If signed in, push the restored data now (otherwise it would sit local until a future reconcile).
  if (current()) void triggerSync();
}
