import { db, type SrsCard } from '@/db/db';
import { addPhraseCard, addWordCard, repairCardBack } from '@/features/srs/service';
import { mutateSrsCard } from '@/features/sync/local';
import type { LexiconEntry } from './lexicon';
import { captureDataScope } from '@/features/account/dataScope';
import { termCacheKey, translateText, translateWord } from './translate';
import { dictionaryAnswer, reviewAnswer, sameCardContent } from '@/features/srs/answer';
export { sameCardContent } from '@/features/srs/answer';

export async function editCardAnswer(
  expected: SrsCard,
  translation: string,
  contextGloss: string,
  currentScope = captureDataScope()
): Promise<boolean> {
  const back = translation.trim() || expected.front;
  return Boolean(
    await mutateSrsCard(
      expected.id,
      (row) => {
        if (!sameCardContent(row, expected)) return;
        return { ...row, back, contextGloss: contextGloss.trim() };
      },
      currentScope,
      async () => {
        if (back !== expected.back) {
          await db.translations.put({
            word: termCacheKey(expected.front),
            ru: translation.trim(),
            source: 'manual',
          });
        }
      }
    )
  );
}

/** Edit a term's Russian translation: the card's back (if any) is the display source; the
 *  translations cache is updated too so Review's on-demand lookup agrees. `manual` never gets
 *  overwritten by an auto-fetch, including an explicitly cleared answer. */
export async function setTranslation(
  entry: LexiconEntry,
  ru: string
): Promise<boolean> {
  const value = ru.trim();
  const current = captureDataScope();
  if (entry.cardId) {
    return Boolean(
      await mutateSrsCard(
        entry.cardId,
        (row) => {
          const answer = dictionaryAnswer(row);
          if (answer && answer !== entry.translation) return;
          return { ...row, back: value || entry.display };
        },
        current,
        async () => {
          await db.translations.put({
            word: termCacheKey(entry.display),
            ru: value,
            source: 'manual',
          });
        }
      )
    );
  }
  await db.transaction('rw', db.translations, async () => {
    if (current())
      await db.translations.put({
        word: termCacheKey(entry.display),
        ru: value,
        source: 'manual',
      });
  });
  return current();
}

/** Add a user-supplied term. A term with whitespace becomes a phrase card, otherwise a word card. */
export async function addTerm(
  term: string,
  translation: string,
  context: string
): Promise<SrsCard | null> {
  const current = captureDataScope();
  const t = term.trim();
  if (!t) return null;
  const tr = translation.trim();
  const ctx = context.trim() || undefined;
  const key = t.toLowerCase();
  const isPhrase = /\s/.test(t);
  const id = isPhrase ? `phrase:${key}` : `word:${key}`;

  const saved = isPhrase ? await addPhraseCard(t, tr || t, ctx) : await addWordCard(t, tr || t, ctx);
  if (!saved || !current()) return null;
  try {
    return (await mutateSrsCard(id, (row) => ({
      ...row,
      back: tr || row.back,
      contextSentence: ctx || row.contextSentence,
      contextGloss: ctx && row.contextSentence !== ctx ? undefined : row.contextGloss,
    }), current, async () => {
      if (tr) await db.translations.put({ word: key, ru: tr, source: 'manual' });
    })) ?? null;
  } catch {
    return null;
  }
}

export async function translateAddedTerm(
  card: SrsCard,
  current = captureDataScope()
): Promise<'done' | 'unavailable' | 'superseded'> {
  if (!current()) return 'superseded';
  if (reviewAnswer(card)) return 'done';
  const text = await (card.kind === 'phrase' ? translateText : translateWord)(card.front);
  if (!current()) return 'superseded';
  if (!text) return 'unavailable';
  return await repairCardBack(card.id, text, current, card) ? 'done' : 'superseded';
}
