import { test, expect } from 'vitest';
import { wordSpans } from './audio';

test('wordSpans returns char offsets for each word, keeping apostrophes', () => {
  const text = "I don't know.";
  const spans = wordSpans(text);
  expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['I', "don't", 'know']);
});

test('wordSpans skips punctuation and whitespace', () => {
  const spans = wordSpans('  Hello,  world!  ');
  expect(spans).toEqual([
    { start: 2, end: 7 },
    { start: 10, end: 15 },
  ]);
});

test('wordSpans is empty for text with no letters', () => {
  expect(wordSpans('123 — 456!')).toEqual([]);
});
