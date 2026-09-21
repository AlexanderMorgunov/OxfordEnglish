import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Grade,
} from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';
import { logReview, recordSave } from '@/features/stats/activity';
import { addSrsCard, putSrsCard, softDeleteSrsCard } from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';

export { Rating };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

type NewCard = Omit<SrsCard, 'due' | 'card'>;

/** Create a card if one with this id doesn't already exist (never resets a live schedule).
 *  Resolves true only when a card was actually added — what the "saved" stats count. */
async function upsert(card: NewCard): Promise<boolean> {
  try {
    if (await db.srsCards.get(card.id)) return false;
    const fsrsCard = createEmptyCard(new Date());
    await addSrsCard({ ...card, due: fsrsCard.due, card: fsrsCard, createdAt: Date.now() });
    return true;
  } catch {
    // best-effort — SRS is non-critical if IndexedDB is unavailable
    return false;
  }
}

export async function addWordCard(
  word: string,
  back: string,
  context?: string,
  contextGloss?: string,
  sourceDayId?: string
): Promise<void> {
  const added = await upsert({
    id: `word:${word.toLowerCase()}`,
    kind: 'word',
    front: word,
    back: back || word,
    contextSentence: context,
    contextGloss,
    sourceDayId,
    tags: [],
  });
  if (added) await recordSave('word');
}

export async function addPhraseCard(
  phrase: string,
  back: string,
  context?: string,
  sourceDayId?: string
): Promise<void> {
  const added = await upsert({
    id: `phrase:${phrase.toLowerCase()}`,
    kind: 'phrase',
    front: phrase,
    back: back || phrase,
    contextSentence: context,
    sourceDayId,
    tags: [],
  });
  if (added) await recordSave('phrase');
}

/**
 * Mistake cards are no longer created — `fromError` rows only exist on devices that practised before
 * this. Everything that READS them stays: the queue labels them, offers removal, and the lexicon skips
 * them, because those rows are still in people's databases and syncing between their devices.
 *
 * Getting an exercise wrong used to add one automatically. It filled the review queue with cards
 * nobody chose — 321 on the author's own account — and the queue is meant to hold what the learner
 * kept. The cards were second-class everywhere too: no pronunciation, no translation repair, excluded
 * from the word bank, and their front is a gap-fill that cannot be answered away from its exercise.
 * Mistakes are still recorded in `attempts`, which is what every statistic about them reads.
 */

/**
 * Fill in a translation the card was saved without.
 *
 * Every save path writes `back: translation ?? term`, so a lookup that was rate-limited, offline or
 * simply missing leaves the term as its own translation — which the review then renders as a bare dash.
 * The reveal already retried the lookup, but only into component state, so the card asked the network
 * again on every single showing and went back to a dash the moment it could not reach it.
 *
 * Refuses to overwrite a translation that already exists: this repairs, it never corrects.
 */
export async function repairCardBack(id: string, back: string): Promise<boolean> {
  const value = back.trim();
  if (!value) return false;
  try {
    const row = await db.srsCards.get(id);
    if (!row || row.back !== row.front || value === row.front) return false;
    await putSrsCard({ ...row, back: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a card's front is English worth hearing.
 *
 * The button used to be limited to `kind === 'word'`, so every phrase the user saved — the ones most
 * worth hearing, since that is where stress and linking live — was silent. It is not simply "anything
 * with a front" either: a mistake card's front is the EXERCISE, which may be a gap-fill full of
 * underscores or a Russian sentence to translate, and a grammar pattern is a formula, not speech.
 */
export function canPronounce(card: Pick<SrsCard, 'kind' | 'fromError'>): boolean {
  if (card.fromError) return false;
  return card.kind === 'word' || card.kind === 'phrase';
}

export async function getDueCards(now = new Date()): Promise<SrsCard[]> {
  try {
    const rows = await db.srsCards.where('due').belowOrEqual(now).toArray();
    // Tombstones stay in the table so the removal can reach other devices; they are not due for review.
    return rows.filter((c) => !isDeleted(c));
  } catch {
    return [];
  }
}

/** Take a card out of the queue for good. Soft, so the removal survives the next pull. */
export async function dropCard(id: string): Promise<void> {
  try {
    await softDeleteSrsCard(id);
  } catch {
    // best-effort
  }
}

export async function countDue(now = new Date()): Promise<number> {
  try {
    // Counted the same way `getDueCards` lists them: a tombstone is not waiting to be reviewed, and a
    // count that disagrees with the queue it describes is worse than no count.
    return (await getDueCards(now)).length;
  } catch {
    return 0;
  }
}

/** Mistake cards still in the queue, tombstones excluded — the number bulk removal talks about. */
export async function countErrorCards(): Promise<number> {
  try {
    const rows = await db.srsCards.filter((c) => c.fromError === true).toArray();
    return rows.filter((c) => !isDeleted(c)).length;
  } catch {
    return 0;
  }
}

/**
 * Drop every mistake card at once.
 *
 * One at a time is the right granularity for a handful and unusable for three hundred, which is what a
 * few weeks of practice produces. Soft deletes, like `dropCard`, so the removal reaches the account's
 * other devices instead of being undone by the next pull.
 */
export async function dropAllErrorCards(): Promise<number> {
  try {
    const rows = await db.srsCards.filter((c) => c.fromError === true).toArray();
    const live = rows.filter((c) => !isDeleted(c));
    for (const row of live) await softDeleteSrsCard(row.id);
    return live.length;
  } catch {
    return 0;
  }
}

export async function gradeCard(id: string, rating: Grade): Promise<void> {
  const row = await db.srsCards.get(id);
  if (!row) return;
  const next = scheduler.next(row.card, new Date(), rating).card;
  await putSrsCard({ ...row, card: next, due: next.due });
  await logReview(id, rating);
}
