import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import type { SrsCard, WordStatusValue } from '@/db/db';
import {
  captureDataScope,
  requireDataScope,
} from '@/features/account/dataScope';
import {
  addSrsCard,
  mutateSrsCard,
  putWordStatus,
} from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';
import { recordActivity, recordSave } from '@/features/stats/activity';
import { track } from '@/features/analytics/analytics';
import { useVocabStore } from './vocabStore';
import type { LexiconEntry } from './lexicon';
import type { PartOfSpeech } from './grammar-metadata';

export type CreateVocabularyResult =
  | { state: 'saved'; card: SrsCard }
  | { state: 'existing'; key: string }
  | { state: 'deleted' };

export async function createVocabularyEntry(
  term: string,
  translation: string,
  context: string,
  partOfSpeech?: PartOfSpeech,
  current = captureDataScope()
): Promise<CreateVocabularyResult> {
  const front = term.trim(),
    key = front.toLowerCase(),
    kind = /\s/.test(front) ? 'phrase' : 'word';
  if (!front) throw new Error('Empty term');
  const card = createEmptyCard(new Date());
  const row: SrsCard = {
    id: `${kind}:${key}`,
    kind,
    front,
    back: translation.trim() || front,
    contextSentence: context.trim() || undefined,
    partOfSpeech,
    tags: [],
    card,
    due: card.due,
    createdAt: Date.now(),
    creationId: crypto.randomUUID(),
  };
  const result = await db.transaction(
    'rw',
    [db.srsCards, db.wordStatus, db.translations, db.pending, db.syncState],
    async (): Promise<CreateVocabularyResult> => {
      requireDataScope(current);
      const previous = await db.srsCards.get(row.id),
        status = await db.wordStatus.get(key);
      requireDataScope(current);
      if (previous && isDeleted(previous)) return { state: 'deleted' };
      if (previous || (status && status.status !== 'unknown'))
        return { state: 'existing', key };
      if (!(await addSrsCard(row, current))) throw new Error('Card changed');
      requireDataScope(current);
      if (translation.trim())
        await db.translations.put({
          word: key,
          ru: translation.trim(),
          source: 'manual',
        });
      requireDataScope(current);
      return { state: 'saved', card: row };
    }
  );
  if (result.state === 'saved' && current()) {
    void track(kind === 'word' ? 'word_saved' : 'phrase_saved');
    await recordSave(kind);
  }
  requireDataScope(current);
  return result;
}

export async function changeVocabularyStatus(
  entry: LexiconEntry,
  status: Exclude<WordStatusValue, 'unknown'>,
  current = captureDataScope()
) {
  const previous = await db.transaction(
    'rw',
    [db.wordStatus, db.pending, db.syncState],
    async () => {
      const row = await db.wordStatus.get(entry.key);
      requireDataScope(current);
      await putWordStatus(
        {
          word: entry.key,
          status,
          firstSeenAt: row?.firstSeenAt ?? Date.now(),
          encounters: row?.encounters ?? 0,
        },
        current
      );
      return row;
    }
  );
  requireDataScope(current);
  useVocabStore.setState((state) => ({
    statuses: new Map(state.statuses).set(entry.key, status),
  }));
  if (status === 'known' && previous?.status !== 'known')
    void recordActivity({ learned: 1 });
}

export async function removeVocabularyCard(
  entry: LexiconEntry,
  current = captureDataScope()
) {
  if (!entry.cardId) throw new Error('Missing card');
  const saved = await mutateSrsCard(
    entry.cardId,
    (row) =>
      row.front.toLowerCase() === entry.key
        ? { ...row, deletedAt: Math.max(Date.now(), row.updatedAt ?? 0) + 1 }
        : undefined,
    current
  );
  requireDataScope(current);
  if (!saved) throw new Error('Card changed');
}

export async function addVocabularyCard(
  entry: LexiconEntry,
  current = captureDataScope()
) {
  const card = createEmptyCard(new Date()),
    kind = entry.kind;
  const row: SrsCard = {
    id: `${kind}:${entry.key}`,
    kind,
    front: entry.display,
    back: entry.translation || entry.display,
    contextSentence: entry.context,
    contextGloss: entry.contextGloss,
    tags: [],
    card,
    due: card.due,
    createdAt: Date.now(),
    creationId: crypto.randomUUID(),
  };
  requireDataScope(current);
  const saved = await addSrsCard(row, current);
  requireDataScope(current);
  if (!saved) throw new Error('Card already exists or was removed');
  void track(kind === 'word' ? 'word_saved' : 'phrase_saved');
  await recordSave(kind);
}
