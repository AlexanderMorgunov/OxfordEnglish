import { expect, test } from 'vitest';
import { grammarMetadata, isPartOfSpeech, partOfSpeechLabel } from './grammar-metadata';
import type { PosData } from './grammar-metadata';
import type { LemmaData } from './lemma';
import type { SrsCard } from '@/db/db';

const lemma: LemmaData = { byForm: new Map([['went', 'go'], ['was', 'be']]), lemmas: new Set(['go', 'be', 'record', 'must', 'main', 'information']) };
const data: PosData = new Map([['go', ['verb']], ['record', ['noun', 'verb']], ['main', ['adjective']], ['information', ['noun']]]);
const card = (front: string, partOfSpeech?: SrsCard['partOfSpeech']): Pick<SrsCard, 'front' | 'kind' | 'partOfSpeech'> => ({ front, kind: 'word', partOfSpeech });

test('attested verb base is a secondary cue and the original front is unchanged', () => {
  const original = card('went');
  expect(grammarMetadata(original, lemma, data)).toEqual({ partsOfSpeech: ['verb'], infinitive: 'to go' });
  expect(original.front).toBe('went');
});

test('multiple headword readings stay ambiguous and a selected meaning takes precedence', () => {
  expect(grammarMetadata(card('record'), lemma, data)).toEqual({ partsOfSpeech: ['noun', 'verb'], infinitive: undefined });
  expect(grammarMetadata(card('record', 'noun'), lemma, data)).toEqual({ partsOfSpeech: ['noun'], infinitive: undefined });
});

test.each(['must', 'was', 'have', 'do', 'could', 'ought', 'need', 'dare'])('modal or auxiliary %s has no synthetic to cue', term => {
  expect(grammarMetadata(card(term, 'verb'), lemma).infinitive).toBeUndefined();
});

test.each(['main', 'information', 'children', 'hour', 'university'])('noun/adjective %s receives no fabricated usage prefix', term => {
  expect(grammarMetadata(card(term, term === 'main' ? 'adjective' : 'noun'), lemma).infinitive).toBeUndefined();
});

test.each(['to look after', 'be fond of', 'a piece of advice'])('saved phrase %s is preserved', term => {
  const phrase = { ...card(term, 'phrase'), kind: 'phrase' as const };
  expect(grammarMetadata(phrase, lemma)).toEqual({ partsOfSpeech: ['phrase'], infinitive: undefined });
  expect(phrase.front).toBe(term);
});

test('unknown/error/pattern terms do not inherit synthetic grammatical labels', () => {
  expect(grammarMetadata(card('custom'), lemma)).toEqual({ partsOfSpeech: [], infinitive: undefined });
  expect(grammarMetadata({ ...card('go'), fromError: true }, lemma, data)).toEqual({ partsOfSpeech: [] });
  expect(grammarMetadata({ ...card('go'), kind: 'grammar-pattern' }, lemma, data)).toEqual({ partsOfSpeech: [] });
});

test('unattested base and suffix guesses cannot produce an infinitive cue', () => {
  expect(grammarMetadata(card('customing', 'verb'), lemma).infinitive).toBeUndefined();
});

test.each([['found', 'find'], ['saw', 'see'], ['lay', 'lie']])('an own-base/form collision for %s preserves POS without guessing an infinitive', (front, base) => {
  // These overlapping headwords and inflections are present in the shipped lemma dataset.
  const ambiguous: LemmaData = { byForm: new Map([[front, base]]), lemmas: new Set([front, base]) };
  expect(grammarMetadata(card(front, 'verb'), ambiguous)).toEqual({ partsOfSpeech: ['verb'], infinitive: undefined });
});

test('part-of-speech labels are validated and localized', () => {
  expect(isPartOfSpeech('noun')).toBe(true);
  expect(isPartOfSpeech('modal')).toBe(false);
  expect(partOfSpeechLabel('noun', 'ru')).toBe('существительное');
  expect(partOfSpeechLabel('verb', 'en')).toBe('verb');
});
