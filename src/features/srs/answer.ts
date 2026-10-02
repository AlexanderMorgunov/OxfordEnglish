import type { SrsCard } from '@/db/db';

export function sameCardContent(a: SrsCard, b: SrsCard): boolean {
  return a.front === b.front && a.back === b.back && a.contextSentence === b.contextSentence && a.contextGloss === b.contextGloss;
}

export function dictionaryAnswer(card: SrsCard): string | undefined {
  const back = card.back.trim();
  return back &&
    (card.fromError || back.toLowerCase() !== card.front.trim().toLowerCase())
    ? back
    : undefined;
}

export function reviewAnswer(card: SrsCard): string | undefined {
  return card.contextGloss?.trim() || dictionaryAnswer(card);
}
