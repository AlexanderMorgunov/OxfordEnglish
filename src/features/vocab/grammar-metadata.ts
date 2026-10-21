import type { SrsCard } from '@/db/db';
import type { LemmaData } from './lemma';

export const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection', 'determiner', 'phrase', 'other'] as const;
export type PartOfSpeech = typeof PARTS_OF_SPEECH[number];
export type PosData = Map<string, PartOfSpeech[]>;

export const isPartOfSpeech = (value: unknown): value is PartOfSpeech =>
  typeof value === 'string' && PARTS_OF_SPEECH.some(pos => pos === value);

const RU_LABELS: Record<PartOfSpeech, string> = {
  noun: 'существительное', verb: 'глагол', adjective: 'прилагательное', adverb: 'наречие',
  pronoun: 'местоимение', preposition: 'предлог', conjunction: 'союз', interjection: 'междометие',
  determiner: 'определитель', phrase: 'фраза', other: 'другое',
};

export const partOfSpeechLabel = (pos: PartOfSpeech, lang: 'ru' | 'en'): string =>
  lang === 'ru' ? RU_LABELS[pos] : pos;

const NO_INFINITIVE_CUE = new Set(['be', 'am', 'is', 'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'will', 'would', 'ought', 'need', 'dare']);

export function grammarMetadata(
  card: Pick<SrsCard, 'front' | 'kind' | 'fromError' | 'partOfSpeech'>,
  lemma: LemmaData,
  data: PosData = new Map()
): { partsOfSpeech: PartOfSpeech[]; infinitive?: string } {
  if (card.fromError || card.kind === 'grammar-pattern') return { partsOfSpeech: [] };
  const word = card.front.trim().toLowerCase();
  const attestedBase = lemma.byForm.get(word) ?? (lemma.lemmas.has(word) ? word : undefined);
  const ambiguousBase = lemma.lemmas.has(word) && attestedBase !== word;
  const partsOfSpeech = isPartOfSpeech(card.partOfSpeech)
    ? [card.partOfSpeech]
    : [...new Set(data.get(word) ?? (attestedBase ? data.get(attestedBase) : undefined) ?? [])];
  const infinitive = card.kind === 'word' && /^[a-z]+$/.test(word) && partsOfSpeech.length === 1
    && partsOfSpeech[0] === 'verb' && attestedBase && !ambiguousBase && !NO_INFINITIVE_CUE.has(word)
    && !NO_INFINITIVE_CUE.has(attestedBase) && /^[a-z]+$/.test(attestedBase)
    ? `to ${attestedBase}` : undefined;
  return { partsOfSpeech, infinitive };
}
