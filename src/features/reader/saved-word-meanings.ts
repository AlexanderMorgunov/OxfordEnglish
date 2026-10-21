import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db/db';
import type { SrsCard } from '@/db/db';
import { captureDataScope } from '@/features/account/dataScope';
import { isDeleted } from '@/features/sync/resolve';
import { WORD_SPLIT_RE, WORD_TEST_RE } from '@/shared/lib/audio';

const sentenceKey = (text: string) => text.trim().replace(/\s+/g, ' ');
const usable = (text: string | undefined, front: string) => Boolean(text?.trim()) && text!.trim().toLowerCase() !== front.trim().toLowerCase();
export function savedWordMeaning(card: SrsCard | undefined, sentence: string): string | undefined {
  if (!card || card.fromError || isDeleted(card) || card.kind !== 'word' || !card.id.startsWith('word:')) return;
  if (card.contextSentence && sentenceKey(card.contextSentence) === sentenceKey(sentence) && usable(card.contextGloss, card.front)) return card.contextGloss!.trim();
  if (usable(card.back, card.front)) return card.back.trim();
}

export async function readSavedWord(word: string): Promise<SrsCard | undefined> {
  const current = captureDataScope();
  try {
    const card = await db.srsCards.get(`word:${word.toLowerCase()}`);
    return current() && card?.front.trim().toLowerCase() === word.toLowerCase() ? card : undefined;
  } catch { return undefined; }
}

export function useSavedWordCards(paragraphs: string[], revision: number) {
  const key = useMemo(() => [...new Set(paragraphs.flatMap(p => p.split(WORD_SPLIT_RE)
    .filter(w => WORD_TEST_RE.test(w)).map(w => `word:${w.replace(/^'+|'+$/g, '').toLowerCase()}`)))].sort().join('\n'), [paragraphs]);
  const [result, setResult] = useState<{ key: string; revision: number; cards: Map<string, SrsCard> } | null>(null);
  useEffect(() => {
    const current = captureDataScope();
    const subscription = liveQuery(() => db.srsCards.where('id').anyOf(key ? key.split('\n') : []).toArray()).subscribe({
      next: rows => {
        if (!current()) return;
        const cards = new Map(rows.filter(c => !c.fromError && !isDeleted(c) && c.kind === 'word' && c.id === `word:${c.front.trim().toLowerCase()}`)
          .map(c => [c.front.trim().toLowerCase(), c]));
        setResult({ key, revision, cards });
      },
      error: () => { if (current()) setResult({ key, revision, cards: new Map() }); },
    });
    return () => subscription.unsubscribe();
  }, [key, revision]);
  return result?.key === key && result.revision === revision ? result.cards : undefined;
}
