import { db, type SrsCard } from '@/db/db';

export async function exportData(): Promise<string> {
  const [attempts, wordStatus, srsCards, checkpoints, translations] =
    await Promise.all([
      db.attempts.toArray(),
      db.wordStatus.toArray(),
      db.srsCards.toArray(),
      db.checkpoints.toArray(),
      db.translations.toArray(),
    ]);
  return JSON.stringify(
    { version: 1, exportedAt: Date.now(), attempts, wordStatus, srsCards, checkpoints, translations },
    null,
    2
  );
}

/** FSRS cards carry Date fields that JSON flattens to strings — revive them. */
function reviveCard(row: SrsCard): SrsCard {
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
};

export async function importData(json: string): Promise<void> {
  const data = JSON.parse(json) as Backup;
  await db.transaction(
    'rw',
    [db.attempts, db.wordStatus, db.srsCards, db.checkpoints, db.translations],
    async () => {
      if (data.attempts) await db.attempts.bulkPut(data.attempts as never);
      if (data.wordStatus) await db.wordStatus.bulkPut(data.wordStatus as never);
      if (data.srsCards) await db.srsCards.bulkPut(data.srsCards.map(reviveCard));
      if (data.checkpoints) await db.checkpoints.bulkPut(data.checkpoints as never);
      if (data.translations) await db.translations.bulkPut(data.translations as never);
    }
  );
}
