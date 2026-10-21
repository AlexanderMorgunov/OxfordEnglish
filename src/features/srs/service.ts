import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Grade,
} from 'ts-fsrs';
import { db, type ReviewLogEntry, type SrsCard } from '@/db/db';
import { logReviewStrict, recordSave } from '@/features/stats/activity';
import {
  addSrsCard,
  mutateSrsCard,
  softDeleteSrsCard,
} from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';
import { captureDataScope, requireDataScope } from '@/features/account/dataScope';
import { dictionaryAnswer, reviewAnswer, sameCardContent } from './answer';
import { termCacheKey } from '@/features/vocab/translate';

export { Rating };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

type NewCard = Omit<SrsCard, 'due' | 'card'>;

/** A live existing card counts as a successful save without resetting or recounting it. */
async function upsert(card: NewCard): Promise<boolean> {
  const current = captureDataScope();
  try {
    const existing = await db.srsCards.get(card.id);
    if (!current()) return false;
    if (existing) return !isDeleted(existing);
    const fsrsCard = createEmptyCard(new Date());
    const added = await addSrsCard(
      { ...card, due: fsrsCard.due, card: fsrsCard, createdAt: Date.now(), creationId: crypto.randomUUID() },
      current
    );
    if (added && current() && (card.kind === 'word' || card.kind === 'phrase'))
      await recordSave(card.kind);
    if (!current()) return false;
    if (added) return true;
    const concurrent = await db.srsCards.get(card.id);
    return Boolean(concurrent && !isDeleted(concurrent) && current());
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
): Promise<boolean> {
  return upsert({
    id: `word:${word.toLowerCase()}`,
    kind: 'word',
    front: word,
    back: back || word,
    contextSentence: context,
    contextGloss,
    sourceDayId,
    tags: [],
  });
}

export async function addPhraseCard(
  phrase: string,
  back: string,
  context?: string,
  sourceDayId?: string,
  contextGloss?: string
): Promise<boolean> {
  return upsert({
    id: `phrase:${phrase.toLowerCase()}`,
    kind: 'phrase',
    front: phrase,
    back: back || phrase,
    contextSentence: context,
    contextGloss,
    sourceDayId,
    tags: [],
  });
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
export async function repairCardBack(
  id: string,
  back: string,
  currentScope = captureDataScope(),
  expected?: SrsCard
): Promise<boolean> {
  const value = back.trim();
  if (!value) return false;
  try {
    return Boolean(
      await mutateSrsCard(
        id,
        async (row) => {
          if (
            row.back !== row.front ||
            value.toLowerCase() === row.front.toLowerCase()
          )
            return;
          if (expected && (
            row.creationId !== expected.creationId || row.createdAt !== expected.createdAt ||
            !sameCardContent(row, expected)
          )) return;
          const cached = await db.translations.get(termCacheKey(row.front));
          if (cached?.source === 'manual' && cached.ru.trim() !== value) return;
          return { ...row, back: value };
        },
        currentScope
      )
    );
  } catch {
    return false;
  }
}

export async function repairCardContext(
  id: string,
  sentence: string,
  gloss: string,
  currentScope = captureDataScope(),
  backAtSave?: string
): Promise<boolean> {
  if (!gloss.trim()) return false;
  return Boolean(
    await mutateSrsCard(
      id,
      (row) => {
        if (
          row.contextSentence !== sentence ||
          row.contextGloss !== undefined ||
          (backAtSave !== undefined && row.back !== backAtSave) ||
          row.fromError
        )
          return;
        return { ...row, contextGloss: gloss.trim() };
      },
      currentScope
    )
  );
}

export async function repairSavedPhrase(
  id: string,
  sentence: string | undefined,
  backAtSave: string,
  result: { text: string; contextual: boolean },
  currentScope = captureDataScope()
): Promise<boolean> {
  return Boolean(await mutateSrsCard(id, (row) => {
    if (row.kind !== 'phrase' || row.contextSentence !== sentence || row.back !== backAtSave || row.contextGloss !== undefined) return;
    const back = dictionaryAnswer(row) ? row.back : result.text;
    return { ...row, back, contextGloss: result.contextual ? result.text : undefined };
  }, currentScope));
}

export function reviewableCards(
  cards: SrsCard[],
  ignored: Set<string>
): SrsCard[] {
  return cards.filter(
    (c) => !isDeleted(c) && (c.fromError || !ignored.has(c.front.toLowerCase()))
  );
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
    const [rows, statuses] = await Promise.all([
      db.srsCards.where('due').belowOrEqual(now).toArray(),
      db.wordStatus.where('status').equals('ignored').toArray(),
    ]);
    return reviewableCards(
      rows,
      new Set(statuses.map((s) => s.word.toLowerCase()))
    );
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
  const current = captureDataScope();
  try {
    const rows = await db.srsCards.filter((c) => c.fromError === true).toArray();
    const live = rows.filter((c) => !isDeleted(c));
    for (const row of live) {
      if (!current()) return 0;
      await softDeleteSrsCard(row.id, current);
    }
    return live.length;
  } catch {
    return 0;
  }
}

export async function gradeCard(
  id: string,
  rating: Grade,
  expectedReps?: number,
  expectedContent?: SrsCard
): Promise<boolean> {
  return Boolean(await gradeCardWithReceipt(id, rating, expectedReps, expectedContent));
}

export type ReviewReceipt = {
  before: SrsCard;
  after: SrsCard;
  review: ReviewLogEntry;
  currentScope: () => boolean;
};

function sameIncarnation(a: SrsCard, b: SrsCard): boolean {
  return a.id === b.id && a.creationId === b.creationId && a.createdAt === b.createdAt;
}

export function sameReviewSchedule(a: SrsCard, b: SrsCard): boolean {
  const signature = (row: SrsCard) => JSON.stringify([
    row.due.getTime(),
    Object.entries(row.card).sort(([a], [b]) => a.localeCompare(b)),
  ]);
  return signature(a) === signature(b);
}

function sameReviewEvent(a: ReviewLogEntry, b: ReviewLogEntry): boolean {
  const version = (row: ReviewLogEntry) => row.modifiedAt ?? row.ts;
  return a.id === b.id && a.cardId === b.cardId && a.ts === b.ts && a.rating === b.rating
    && Number.isFinite(version(a)) && Number.isFinite(version(b)) && version(a) === version(b);
}

export async function gradeCardWithReceipt(
  id: string,
  rating: Grade,
  expectedReps?: number,
  expectedContent?: SrsCard,
  currentScope = captureDataScope()
): Promise<ReviewReceipt | null> {
  let before: SrsCard | undefined;
  let review: ReviewLogEntry | undefined;
  let reviewedAt = 0;
  const saved = await mutateSrsCard(
    id,
    async (row) => {
      const now = new Date();
      if (
        row.due > now ||
        !reviewAnswer(row) ||
        (expectedReps !== undefined && row.card.reps !== expectedReps) ||
        (expectedContent !== undefined && (!sameCardContent(row, expectedContent) || !sameIncarnation(row, expectedContent)
          || row.partOfSpeech !== expectedContent.partOfSpeech))
      )
        return;
      if (
        !row.fromError &&
        (await db.wordStatus.get(row.front.toLowerCase()))?.status === 'ignored'
      )
        return;
      requireDataScope(currentScope);
      before = structuredClone(row);
      reviewedAt = now.getTime();
      const next = scheduler.next(row.card, now, rating).card;
      return { ...row, card: next, due: next.due };
    },
    currentScope,
    async () => {
      requireDataScope(currentScope);
      review = await logReviewStrict(id, rating, reviewedAt);
      requireDataScope(currentScope);
    }
  );
  return saved && before && review && currentScope()
    ? { before, after: structuredClone(saved), review: structuredClone(review), currentScope } : null;
}

export async function reviewCorrectionCard(receipt: ReviewReceipt): Promise<SrsCard | null> {
  if (!receipt.currentScope()) return null;
  const row = await db.srsCards.get(receipt.after.id);
  if (!row || isDeleted(row) || !sameIncarnation(row, receipt.after)
    || !sameReviewSchedule(row, receipt.after) || !reviewAnswer(row)) return null;
  const [event, status] = await Promise.all([
    db.reviewLog.get(receipt.review.id), db.wordStatus.get(row.front.toLowerCase()),
  ]);
  return receipt.currentScope() && event && sameReviewEvent(event, receipt.review)
    && (row.fromError || status?.status !== 'ignored') ? row : null;
}

export async function replaceReviewRating(
  receipt: ReviewReceipt,
  rating: Grade,
  shownContent: SrsCard
): Promise<ReviewReceipt | null> {
  if (!receipt.currentScope()) return null;
  let review: ReviewLogEntry | undefined;
  const saved = await mutateSrsCard(receipt.after.id, async row => {
    if (!sameIncarnation(row, receipt.after) || !sameIncarnation(row, shownContent)
      || !sameReviewSchedule(row, receipt.after) || !sameCardContent(row, shownContent)
      || row.partOfSpeech !== shownContent.partOfSpeech
      || !reviewAnswer(row)) return;
    const [event, status] = await Promise.all([
      db.reviewLog.get(receipt.review.id), db.wordStatus.get(row.front.toLowerCase()),
    ]);
    requireDataScope(receipt.currentScope);
    if (!event || !sameReviewEvent(event, receipt.review)
      || (!row.fromError && status?.status === 'ignored')) return;
    const card = scheduler.next(receipt.before.card, new Date(receipt.review.ts), rating).card;
    review = {
      ...event, rating,
      modifiedAt: Math.max(Date.now(), (event.modifiedAt ?? event.ts) + 1),
    };
    return { ...row, card, due: card.due };
  }, receipt.currentScope, async () => {
    requireDataScope(receipt.currentScope);
    if (!review) throw new Error('Missing review correction');
    await db.reviewLog.put(review);
    requireDataScope(receipt.currentScope);
  });
  return saved && review && receipt.currentScope()
    ? { ...receipt, after: structuredClone(saved), review: structuredClone(review) } : null;
}
