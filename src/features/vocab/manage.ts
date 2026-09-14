import { db, type SrsCard } from '@/db/db';
import { addPhraseCard, addWordCard } from '@/features/srs/service';
import { patchSrsCard } from '@/features/sync/local';
import type { LexiconEntry } from './lexicon';

/** Edit a term's Russian translation: the card's back (if any) is the display source; the
 *  translations cache is updated too so Review's on-demand lookup agrees. `manual` never gets
 *  overwritten by an auto-fetch (translateWord trusts a cached Cyrillic value). */
export async function setTranslation(entry: LexiconEntry, ru: string): Promise<void> {
  const value = ru.trim();
  try {
    if (entry.cardId) await patchSrsCard(entry.cardId, { back: value || entry.display });
    await db.translations.put({ word: entry.key, ru: value, source: 'manual' });
  } catch {
    // best-effort
  }
}

/** Add a user-supplied term. A term with whitespace becomes a phrase card, otherwise a word card. */
export async function addTerm(term: string, translation: string, context: string): Promise<void> {
  const t = term.trim();
  if (!t) return;
  const tr = translation.trim();
  const ctx = context.trim() || undefined;
  const key = t.toLowerCase();
  const isPhrase = /\s/.test(t);
  const id = isPhrase ? `phrase:${key}` : `word:${key}`;

  if (isPhrase) await addPhraseCard(t, tr || t, ctx);
  else await addWordCard(t, tr || t, ctx);

  // upsert() won't touch an existing card, so patch back/context to reflect what the user typed.
  const patch: Partial<SrsCard> = {};
  if (tr) patch.back = tr;
  if (ctx) patch.contextSentence = ctx;
  try {
    if (Object.keys(patch).length) await patchSrsCard(id, patch);
    if (tr) await db.translations.put({ word: key, ru: tr, source: 'manual' });
  } catch {
    // best-effort
  }
}
