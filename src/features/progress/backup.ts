import { db, type Bookmark, type SrsCard } from '@/db/db';
import { reviveCard } from '@/features/srs/reviveCard';
import { stampImported, enqueueForPush, currentInstallId } from '@/features/sync/local';
import { triggerSync } from '@/features/sync/run';

export { reviveCard };

export async function exportData(): Promise<string> {
  const [attempts, wordStatus, srsCards, checkpoints, translations, catalogCache, bookmarks] =
    await Promise.all([
      db.attempts.toArray(),
      db.wordStatus.toArray(),
      db.srsCards.toArray(),
      db.checkpoints.toArray(),
      db.translations.toArray(),
      db.catalogCache.toArray(),
      db.bookmarks.toArray(),
    ]);
  return JSON.stringify(
    {
      version: 3,
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
  const data = JSON.parse(json) as Backup;
  const iid = await currentInstallId(); // fetched before the tx (syncState is out of its table scope)
  await db.transaction(
    'rw',
    [db.attempts, db.wordStatus, db.srsCards, db.checkpoints, db.translations, db.catalogCache, db.bookmarks],
    async () => {
      // `++id` stores: append (a merge across devices), never bulkPut-by-id (which would clobber). Stamped
      // with a global syncId + meta so a later sync/reconcile treats them as distinct, sync-able rows.
      if (data.attempts) await db.attempts.bulkAdd(stampImported('attempts', stripId(data.attempts) as object[], iid) as never);
      if (data.checkpoints) await db.checkpoints.bulkAdd(stampImported('checkpoints', stripId(data.checkpoints) as object[], iid) as never);
      // Natural-key stores: merge by key (bookmarks carry an inbound string UUID — never stripId).
      if (data.wordStatus) await db.wordStatus.bulkPut(stampImported('wordStatus', data.wordStatus as object[], iid) as never);
      if (data.srsCards) await db.srsCards.bulkPut(stampImported('srsCards', data.srsCards.map(reviveCard), iid));
      if (data.translations) await db.translations.bulkPut(data.translations as never); // not synced
      if (data.catalogCache) await db.catalogCache.bulkPut(data.catalogCache as never); // not synced
      if (data.bookmarks) await db.bookmarks.bulkPut(stampImported('bookmarks', data.bookmarks, iid));
    }
  );
  // If signed in, push the restored data now (otherwise it would sit local until a future reconcile).
  await enqueueForPush(['attempts', 'checkpoints', 'wordStatus', 'srsCards', 'bookmarks']);
  void triggerSync();
}
