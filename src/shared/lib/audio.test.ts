import { test, expect } from 'vitest';
import { wordSpans, chunkPassage } from './audio';

test('chunkPassage splits on sentences, each chunk sliceable back at its offset', () => {
  const text = 'Peter Blood smoked a pipe. He tended the geraniums. All Bridgewater was in arms.';
  const chunks = chunkPassage(text);
  expect(chunks.length).toBe(3);
  for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  expect(chunks.map((c) => c.text.trim())).toEqual([
    'Peter Blood smoked a pipe.',
    'He tended the geraniums.',
    'All Bridgewater was in arms.',
  ]);
});

test('chunkPassage hard-splits a very long sentence under maxLen at spaces', () => {
  const text = `${'word '.repeat(120).trim()}.`; // ~600 chars, one sentence
  const chunks = chunkPassage(text, 160);
  expect(chunks.length).toBeGreaterThan(1);
  for (const c of chunks) {
    expect(c.text.length).toBeLessThanOrEqual(160);
    expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
  }
  // Every word is covered — a boundary event at any char maps into some chunk.
  expect(chunks.map((c) => c.text).join('')).toBe(text);
});

test('chunkPassage returns a single chunk for short text and nothing for blank', () => {
  expect(chunkPassage('Hello there.')).toEqual([{ text: 'Hello there.', offset: 0 }]);
  expect(chunkPassage('   ')).toEqual([]);
});

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
