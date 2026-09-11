import { test, expect } from 'vitest';
import { buildBookIndex, countWords, positionOf, splitParas } from './position';

test('countWords and splitParas', () => {
  expect(countWords('  a  b\nc ')).toBe(3);
  expect(countWords('')).toBe(0);
  expect(splitParas('a\n\nb\n\n\nc')).toEqual(['a', 'b', 'c']);
});

test('positionOf is the share of words before a paragraph (+ words into it)', () => {
  const idx = buildBookIndex([{ text: 'one two\n\nthree' }, { text: 'four five six\n\nseven eight' }]);
  expect(idx.total).toBe(8);
  expect(idx.pageStart).toEqual([0, 3]);
  expect(idx.paraStart).toEqual([
    [0, 2],
    [3, 6],
  ]);
  expect(positionOf(idx, 0, 0)).toBe(0);
  expect(positionOf(idx, 1, 1)).toBe(6 / 8);
  expect(positionOf(idx, 1, 1, 1)).toBe(7 / 8);
  expect(positionOf(idx, 1, 1, 99)).toBe(1);
  expect(positionOf(buildBookIndex([]), 0, 0)).toBe(0);
});
