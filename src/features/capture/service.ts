import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import type { SrsCard, WordStatus, WordTranslation } from '@/db/db';
import {
  captureDataScope,
  requireDataScope,
} from '@/features/account/dataScope';
import {
  addSrsCard,
  mutateSrsCard,
  putWordStatus,
  restoreSrsCard,
} from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';
import { track } from '@/features/analytics/analytics';
import { recordSave } from '@/features/stats/activity';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { captureDraftError, captureKey } from './links';
import type { CapturePayload } from './links';

export type CaptureSnapshot = {
  key: string;
  card?: SrsCard;
  status?: WordStatus;
  cached?: WordTranslation;
  state: 'new' | 'existing' | 'deleted';
  translation: string;
};
export type CaptureAction = 'save' | 'edit' | 'restore' | 'review' | 'learning';
export class CaptureConflict extends Error {}

async function lookup(term: string): Promise<CaptureSnapshot> {
  const normalized = captureKey(term);
  const [cards, statuses, translations] = await Promise.all([
    db.srsCards.toArray(),
    db.wordStatus.toArray(),
    db.translations.toArray(),
  ]);
  const matching = cards.filter(
    (row) =>
      !row.fromError &&
      (row.kind === 'word' || row.kind === 'phrase') &&
      captureKey(row.front) === normalized
  );
  const card = matching.find((row) => !isDeleted(row)) ?? matching[0];
  const status = statuses.find((row) => captureKey(row.word) === normalized);
  const cached = translations.find(
    (row) => captureKey(row.word) === normalized
  );
  return {
    key:
      card?.front.toLowerCase() ??
      status?.word.toLowerCase() ??
      term.trim().replace(/\s+/g, ' ').toLowerCase(),
    card,
    status,
    cached,
    state:
      card && isDeleted(card)
        ? 'deleted'
        : card || (status && status.status !== 'unknown')
          ? 'existing'
          : 'new',
    translation:
      card?.back && card.back !== card.front ? card.back : (cached?.ru ?? ''),
  };
}

export async function readCapturedPhrase(
  term: string,
  current = captureDataScope()
): Promise<CaptureSnapshot> {
  const result = await db.transaction(
    'r',
    [db.srsCards, db.wordStatus, db.translations],
    () => lookup(term)
  );
  requireDataScope(current);
  return result;
}

function fingerprint(value: CaptureSnapshot): string {
  return JSON.stringify([value.card, value.status, value.cached]);
}

export async function saveCapturedPhrase(
  payload: CapturePayload,
  expected: CaptureSnapshot,
  action: CaptureAction,
  review = true,
  current = captureDataScope()
): Promise<{ changed: boolean; snapshot: CaptureSnapshot }> {
  if (
    (action === 'save' && captureDraftError(payload)) ||
    (action === 'edit' &&
      (!payload.translation.trim() || payload.translation.length > 500))
  )
    throw new Error('Invalid phrase');
  if (captureKey(payload.term) !== captureKey(expected.key))
    throw new CaptureConflict('Phrase changed');
  const result = await db.transaction(
    'rw',
    [
      db.srsCards,
      db.wordStatus,
      db.translations,
      db.pending,
      db.syncState,
      db.reviewLog,
    ],
    async () => {
      requireDataScope(current);
      const actual = await lookup(payload.term);
      requireDataScope(current);
      if (action === 'save' && actual.state !== 'new')
        return { changed: false, snapshot: actual };
      if (fingerprint(actual) !== fingerprint(expected))
        throw new CaptureConflict('Card changed');
      const key =
        actual.status?.word ?? actual.card?.front.toLowerCase() ?? actual.key;
      const term =
        action === 'save'
          ? payload.term.trim().replace(/\s+/g, ' ')
          : (actual.card?.front ?? actual.status?.word ?? payload.term.trim());
      if (action === 'save' || action === 'review') {
        if (
          actual.card ||
          (action === 'review' && actual.status?.status === 'ignored')
        )
          throw new CaptureConflict('Card changed');
        if (action === 'save' && !review) {
          await putWordStatus(
            {
              word: key,
              status: 'learning',
              firstSeenAt: Date.now(),
              encounters: 0,
            },
            current
          );
        } else {
          const card = createEmptyCard(new Date());
          if (
            !(await addSrsCard(
              {
                id: (/\s/.test(term) ? 'phrase:' : 'word:') + key,
                kind: /\s/.test(term) ? 'phrase' : 'word',
                front: term,
                back:
                  action === 'save'
                    ? payload.translation.trim()
                    : actual.translation || term,
                contextSentence:
                  action === 'save'
                    ? payload.context.trim() || undefined
                    : actual.cached?.context,
                tags: [],
                card,
                due: card.due,
                createdAt: Date.now(),
                creationId: crypto.randomUUID(),
              },
              current
            ))
          )
            throw new CaptureConflict('Card changed');
        }
        if (action === 'save')
          await db.translations.put({
            word: key,
            ru: payload.translation.trim(),
            source: 'manual',
            context: payload.context.trim() || undefined,
          });
      } else if (action === 'restore') {
        if (
          !actual.card ||
          actual.state !== 'deleted' ||
          !(await restoreSrsCard(actual.card.id, current))
        )
          throw new CaptureConflict('Card changed');
      } else if (action === 'edit') {
        if (actual.state !== 'existing')
          throw new CaptureConflict('Card changed');
        if (
          actual.card &&
          !(await mutateSrsCard(
            actual.card.id,
            (row) => ({ ...row, back: payload.translation.trim() }),
            current
          ))
        )
          throw new CaptureConflict('Card changed');
        await db.translations.put({
          ...actual.cached,
          word: key,
          ru: payload.translation.trim(),
          source: 'manual',
        });
      } else {
        if (!actual.status || actual.state !== 'existing')
          throw new CaptureConflict('Card changed');
        await putWordStatus({ ...actual.status, status: 'learning' }, current);
      }
      requireDataScope(current);
      return { changed: true, snapshot: await lookup(payload.term) };
    }
  );
  requireDataScope(current);
  if (result.snapshot.status) {
    const status = result.snapshot.status;
    useVocabStore.setState((state) => ({
      statuses: new Map(state.statuses).set(status.word, status.status),
    }));
  }
  if (result.changed && (action === 'save' || action === 'review')) {
    const kind = /\s/.test(payload.term.trim()) ? 'phrase' : 'word';
    void track(kind === 'phrase' ? 'phrase_saved' : 'word_saved');
    try {
      await recordSave(kind);
    } catch {
      /* The durable card already committed. */
    }
  }
  requireDataScope(current);
  return result;
}
