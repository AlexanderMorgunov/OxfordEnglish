import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stems, tokenize, estimateCoverage, classifyWord, type FreqIndex } from './difficulty';

const realFreq = (): FreqIndex => {
  const data = JSON.parse(readFileSync(resolve(process.cwd(), 'public/reader/en-freq.json'), 'utf8'));
  return new Map<string, number>((data.words as string[]).map((w, i) => [w, i + 1]));
};

test('stems reduces common inflections', () => {
  expect(stems('walked')).toContain('walk');
  expect(stems('cities')).toContain('city');
  expect(stems('running')).toContain('run');
  expect(stems('tried')).toContain('try');
  expect(stems('making')).toContain('make');
  expect(stems('stood')).toContain('stand');
  expect(stems("dog's")).toContain('dog');
  // derivational suffixes are left alone so they don't collide with real words
  expect(stems('forest')).not.toContain('for');
  expect(stems('only')).not.toContain('on');
});

test('tokenize keeps words, drops punctuation', () => {
  expect(tokenize('The dog, and the cat!')).toEqual(['the', 'dog', 'and', 'the', 'cat']);
});

// The verification §11 asks for: a normal passage must NOT systematically under-report.
const PASSAGE = `The old house stood at the end of a quiet street. Every morning the woman
walked to the market, carrying a small basket. She liked the fresh bread and the bright
flowers that the sellers brought from their gardens. The children played near the river,
laughing and running between the trees. In the evenings, families gathered together and
told stories about the past. Life moved slowly, but nobody seemed to mind. It was a simple
place, and the people who lived there were happy.`;

test('coverage of ordinary prose is high at a B1 band', () => {
  const freq = realFreq();
  const { coverage } = estimateCoverage(PASSAGE, { freq, known: new Set(), rankThreshold: 3000 });
  expect(coverage).toBeGreaterThan(0.9);
});

test('the suffix stripper lifts coverage vs raw surface lookup', () => {
  const freq = realFreq();
  const known = new Set<string>();
  const withStems = estimateCoverage(PASSAGE, { freq, known, rankThreshold: 3000 }).coverage;
  // Raw lookup: only exact surface forms count.
  const tokens = tokenize(PASSAGE);
  const rawKnown = tokens.filter((t) => (freq.get(t) ?? Infinity) <= 3000).length;
  const raw = rawKnown / tokens.length;
  expect(withStems).toBeGreaterThanOrEqual(raw);
});

test('classifyWord: explicit status wins, else frequency band decides', () => {
  const freq: FreqIndex = new Map([
    ['the', 1],
    ['walk', 900],
    ['quokka', 8000],
  ]);
  const opts = { freq, rankThreshold: 1500 };
  // explicit personal status always wins
  expect(classifyWord('anything', { ...opts, status: 'known' })).toBe('known');
  expect(classifyWord('anything', { ...opts, status: 'learning' })).toBe('learning');
  expect(classifyWord('anything', { ...opts, status: 'ignored' })).toBe('ignored');
  expect(classifyWord('anything', { ...opts, status: 'unknown' })).toBe('new');
  // unmarked: frequent enough for the level → known (via a stem too)
  expect(classifyWord('the', opts)).toBe('known');
  expect(classifyWord('walked', opts)).toBe('known'); // walk is in band
  // unmarked and above the band / not in list → new
  expect(classifyWord('quokka', opts)).toBe('new'); // rank 8000 > 1500
  expect(classifyWord('zzyzx', opts)).toBe('new'); // not in list
});

test('personal vocabulary counts as known', () => {
  const freq: FreqIndex = new Map();
  const before = estimateCoverage('quokka quokka', { freq, known: new Set(), rankThreshold: 3000 });
  const after = estimateCoverage('quokka quokka', { freq, known: new Set(['quokka']), rankThreshold: 3000 });
  expect(before.coverage).toBe(0);
  expect(after.coverage).toBe(1);
});
