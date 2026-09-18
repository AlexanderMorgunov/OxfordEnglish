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

export async function addErrorCard(
  exerciseId: string,
  front: string,
  back: string,
  tags: string[],
  sourceDayId?: string
): Promise<void> {
  await upsert({
    id: `err:${exerciseId}`,
    kind: 'phrase',
    front,
    back,
    tags,
    fromError: true,
    sourceDayId,
  });
}

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
    return await db.srsCards.where('due').belowOrEqual(now).count();
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
