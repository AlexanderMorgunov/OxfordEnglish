import { db, type Bookmark, type SrsCard } from '@/db/db';

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

/** FSRS cards carry Date fields that JSON flattens to strings — revive them. */
export function reviveCard(row: SrsCard): SrsCard {
  const card = row.card as SrsCard['card'] & { last_review?: string | Date };
  return {
    ...row,
    due: new Date(row.due),
    card: {
      ...card,
      due: new Date(card.due),
      last_review: card.last_review ? new Date(card.last_review) : undefined,
    },
  };
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
  await db.transaction(
    'rw',
    [db.attempts, db.wordStatus, db.srsCards, db.checkpoints, db.translations, db.catalogCache, db.bookmarks],
    async () => {
      // `++id` stores: append (a merge across devices), never bulkPut-by-id (which would clobber).
      if (data.attempts) await db.attempts.bulkAdd(stripId(data.attempts) as never);
      if (data.checkpoints) await db.checkpoints.bulkAdd(stripId(data.checkpoints) as never);
      // Natural-key stores: merge by key (bookmarks carry an inbound string UUID — never stripId).
      if (data.wordStatus) await db.wordStatus.bulkPut(data.wordStatus as never);
      if (data.srsCards) await db.srsCards.bulkPut(data.srsCards.map(reviveCard));
      if (data.translations) await db.translations.bulkPut(data.translations as never);
      if (data.catalogCache) await db.catalogCache.bulkPut(data.catalogCache as never);
      if (data.bookmarks) await db.bookmarks.bulkPut(data.bookmarks);
    }
  );
}
