import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import type { SrsCard } from '@/db/db';
import { captureDataScope, requireDataScope } from '@/features/account/dataScope';
import { addSrsCard } from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';
import { recordSave } from '@/features/stats/activity';
import { isPartOfSpeech } from './grammar-metadata';
import type { PartOfSpeech } from './grammar-metadata';

export type SenseSaveResult = { state: 'saved'; card: SrsCard } | { state: 'existing' | 'deleted' | 'failed' };

export async function addSenseTerm(term: string, translation: string, context: string, partOfSpeech?: PartOfSpeech): Promise<SenseSaveResult> {
  const current = captureDataScope();
  const front = term.trim();
  const back = translation.trim();
  if (!front || !back) return { state: 'failed' };
  const kind = /\s/.test(front) ? 'phrase' : 'word';
  const id = `${kind}:${front.toLowerCase()}`;
  const card = createEmptyCard(new Date());
  const row: SrsCard = {
    id, kind, front, back, contextSentence: context.trim() || undefined,
    partOfSpeech: isPartOfSpeech(partOfSpeech) ? partOfSpeech : undefined,
    tags: [], card, due: card.due, createdAt: Date.now(), creationId: crypto.randomUUID(),
  };
  try {
    const result = await db.transaction('rw', [db.srsCards, db.pending, db.translations, db.syncState], async (): Promise<SenseSaveResult> => {
      requireDataScope(current);
      const previous = await db.srsCards.get(id);
      requireDataScope(current);
      if (previous) return { state: isDeleted(previous) ? 'deleted' : 'existing' };
      if (!await addSrsCard(row, current)) return { state: 'failed' };
      requireDataScope(current);
      await db.translations.put({ word: front.toLowerCase(), ru: back, source: 'manual' });
      requireDataScope(current);
      return { state: 'saved', card: row };
    });
    if (result.state === 'saved' && current()) await recordSave(kind);
    requireDataScope(current);
    return result;
  } catch {
    return { state: 'failed' };
  }
}
