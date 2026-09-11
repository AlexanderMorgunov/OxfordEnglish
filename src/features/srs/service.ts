import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Grade,
} from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';
import { logReview, recordSave } from '@/features/stats/activity';

export { Rating };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

type NewCard = Omit<SrsCard, 'due' | 'card'>;

/** Create a card if one with this id doesn't already exist (never resets a live schedule).
 *  Resolves true only when a card was actually added — what the "saved" stats count. */
async function upsert(card: NewCard): Promise<boolean> {
  try {
    if (await db.srsCards.get(card.id)) return false;
    const fsrsCard = createEmptyCard(new Date());
    await db.srsCards.add({ ...card, due: fsrsCard.due, card: fsrsCard, createdAt: Date.now() });
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

export async function getDueCards(now = new Date()): Promise<SrsCard[]> {
  try {
    return await db.srsCards.where('due').belowOrEqual(now).toArray();
  } catch {
    return [];
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
  await db.srsCards.put({ ...row, card: next, due: next.due });
  await logReview(id, rating);
}
