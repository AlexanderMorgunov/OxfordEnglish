import { test, expect } from 'vitest';
import { generateExercises } from './exercises';
import type { FreqIndex } from './difficulty';

const common = ['the', 'a', 'was', 'in', 'of', 'and', 'they', 'to', 'it', 'that', 'for', 'an', 'all', 'day', 'found', 'showed', 'way', 'children', 'walked', 'into', 'this', 'hidden', 'exciting'];
const targets: [string, number][] = [
  ['forest', 3200],
  ['treasure', 3300],
  ['mysterious', 3400],
  ['ancient', 3350],
];
const freq: FreqIndex = new Map<string, number>([
  ...common.map((w, i) => [w, i + 1] as [string, number]),
  ...targets,
]);

const TEXT =
  'The children walked into the ancient forest. They found a mysterious map that showed the way to a hidden treasure. It was an exciting day for them all.';

test('generates choice exercises from the learner\'s unknown, in-band words', () => {
  const ex = generateExercises(TEXT, {
    freq,
    known: new Set(),
    rankThreshold: 3000,
    idPrefix: 'reader.b1.0',
  });
  expect(ex.length).toBe(4); // forest, treasure, mysterious, ancient
  for (const e of ex) {
    expect(e.type).toBe('choice');
    expect(e.id.startsWith('reader.b1.0.')).toBe(true);
    expect(e.tags).toContain('reader.vocab');
    if (e.type === 'choice') {
      expect(e.prompt).toContain('___');
      expect(e.options.length).toBe(4);
      expect(e.options[e.correctIndex]).toBeDefined();
      expect(new Set(e.options).size).toBe(4); // no duplicate options
    }
  }
  // every target should be the answer of exactly one exercise
  const answers = ex.map((e) => (e.type === 'choice' ? e.options[e.correctIndex] : ''));
  expect(new Set(answers)).toEqual(new Set(['forest', 'treasure', 'mysterious', 'ancient']));
});

test('is deterministic — same input yields identical exercises', () => {
  const a = generateExercises(TEXT, { freq, known: new Set(), rankThreshold: 3000, idPrefix: 'x' });
  const b = generateExercises(TEXT, { freq, known: new Set(), rankThreshold: 3000, idPrefix: 'x' });
  expect(a).toEqual(b);
});

test('skips words the learner already knows', () => {
  const ex = generateExercises(TEXT, {
    freq,
    known: new Set(['forest', 'treasure', 'mysterious', 'ancient']),
    rankThreshold: 3000,
    idPrefix: 'x',
  });
  expect(ex.length).toBe(0);
});
