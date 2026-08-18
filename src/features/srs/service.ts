import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Grade,
} from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';

export { Rating };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

type NewCard = Omit<SrsCard, 'due' | 'card'>;

/** Create a card if one with this id doesn't already exist (never resets a live schedule). */
async function upsert(card: NewCard): Promise<void> {
  try {
    if (await db.srsCards.get(card.id)) return;
    const fsrsCard = createEmptyCard(new Date());
    await db.srsCards.add({ ...card, due: fsrsCard.due, card: fsrsCard });
  } catch {
    // best-effort — SRS is non-critical if IndexedDB is unavailable
  }
}

export function addWordCard(
  word: string,
  back: string,
  context?: string,
  sourceDayId?: string
): Promise<void> {
  return upsert({
    id: `word:${word.toLowerCase()}`,
    kind: 'word',
    front: word,
    back: back || word,
    contextSentence: context,
    sourceDayId,
    tags: [],
  });
}

export function addPhraseCard(
  phrase: string,
  back: string,
  context?: string,
  sourceDayId?: string
): Promise<void> {
  return upsert({
    id: `phrase:${phrase.toLowerCase()}`,
    kind: 'phrase',
    front: phrase,
    back: back || phrase,
    contextSentence: context,
    sourceDayId,
    tags: [],
  });
}

export function addErrorCard(
  exerciseId: string,
  front: string,
  back: string,
  tags: string[],
  sourceDayId?: string
): Promise<void> {
  return upsert({
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
}
