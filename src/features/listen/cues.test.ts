import { activeCueIndex, dictationCorrect, diffWords } from './cues';

const cues = [
  { start: 0, end: 2 },
  { start: 2, end: 5 },
  { start: 5, end: 8 },
];

test('activeCueIndex finds the cue covering the current time', () => {
  expect(activeCueIndex(0, cues)).toBe(0);
  expect(activeCueIndex(1.9, cues)).toBe(0);
  expect(activeCueIndex(2, cues)).toBe(1);
  expect(activeCueIndex(7.9, cues)).toBe(2);
  expect(activeCueIndex(9, cues)).toBe(-1);
});

test('diffWords marks each expected word ok/miss positionally', () => {
  const parts = diffWords("Let's try something.", "Let's try nothing");
  expect(parts.map((p) => p.ok)).toEqual([true, true, false]);
});

test('dictationCorrect ignores case and trailing punctuation but not wrong words', () => {
  expect(dictationCorrect("Let's try something.", "let's try something")).toBe(true);
  expect(dictationCorrect("Let's try something.", "LET'S TRY SOMETHING")).toBe(true);
  expect(dictationCorrect("Let's try something.", "let's try something else")).toBe(false);
  expect(dictationCorrect("Let's try something.", "let's try")).toBe(false);
});

test('dictationCorrect ignores commas and inner punctuation', () => {
  expect(dictationCorrect('Den, why is it so cold?', 'den why is it so cold')).toBe(true);
  expect(dictationCorrect('Put on a sweater.', 'put on a sweater')).toBe(true);
  expect(dictationCorrect("It's a fine, warm day!", 'its a fine warm day')).toBe(true);
});
