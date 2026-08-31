import { test, expect } from 'vitest';
import { phraseKey, phraseMarkedTokens } from './phrase-marks';
import { WORD_SPLIT_RE } from '@/shared/lib/audio';

test('phraseKey normalizes case, punctuation and whitespace to word tokens', () => {
  expect(phraseKey('Took a  train.')).toBe('took a train');
  expect(phraseKey('  fowling pieces  ')).toBe('fowling pieces');
  expect(phraseKey("don't know")).toBe("don't know");
  expect(phraseKey('— well, then —')).toBe('well then');
});

/** Slots the matcher marks, sliced back out of the sentence for a readable assertion. */
function markedWords(sentence: string, keys: string[]): string[] {
  const parts = sentence.split(WORD_SPLIT_RE);
  const marks = phraseMarkedTokens(sentence, new Set(keys));
  return [...marks].sort((a, b) => a - b).map((i) => parts[i]!);
}

test('marks a saved phrase as a whole word run', () => {
  expect(markedWords('She took a train home.', ['took a train'])).toEqual(['took', 'a', 'train']);
});

test('matches case-insensitively but only whole tokens', () => {
  expect(markedWords('TOOK A TRAIN now.', ['took a train'])).toEqual(['TOOK', 'A', 'TRAIN']);
  // `train` must not match inside `trainer`.
  expect(markedWords('The trainer left.', ['train'])).toEqual([]);
});

test('ignores single-word phrases (those are word status, not phrase underline)', () => {
  expect(markedWords('A lone train passed.', ['train'])).toEqual([]);
});

test('marks two adjacent saved phrases independently', () => {
  expect(markedWords('He took a train and made up his mind.', ['took a train', 'made up'])).toEqual([
    'took',
    'a',
    'train',
    'made',
    'up',
  ]);
});

test('no marks when nothing is saved or nothing matches', () => {
  expect(phraseMarkedTokens('Any sentence here.', new Set())).toEqual(new Set());
  expect(markedWords('Any sentence here.', ['took a train'])).toEqual([]);
});

test('matches a phrase even across internal punctuation between its words', () => {
  // Saved from a range like "wait, then" — the key drops the comma, the run still matches.
  expect(markedWords('I said wait, then go.', ['wait then'])).toEqual(['wait', 'then']);
});
