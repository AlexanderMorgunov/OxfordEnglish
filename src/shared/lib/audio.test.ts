import { test, expect } from 'vitest';
import { wordSpans, chunkPassage, WORD_SPLIT_RE, WORD_TEST_RE } from './audio';
import { toSentences } from '@/features/reader/parse/text';

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

/** The reader renders word tokens by splitting each `toSentences` sentence with WORD_SPLIT_RE, while
 *  read-aloud maps boundary events onto `wordSpans` of the spoken string (`toSentences(...).join`).
 *  If the two token counts ever diverge, the spoken-word highlight drifts off the real word — so this
 *  pins that they stay 1:1, including the dialogue-apostrophe cases that used to break it. */
function renderWordCount(paragraph: string): number {
  let n = 0;
  for (const sentence of toSentences(paragraph)) {
    for (const tok of sentence.split(WORD_SPLIT_RE)) if (WORD_TEST_RE.test(tok)) n += 1;
  }
  return n;
}

test('rendered word tokens align 1:1 with spoken word spans', () => {
  const paragraphs = [
    "'Tis a fine morning, Captain.",
    "'Go,' she said. 'Now.'",
    "'Go.' She left.",
    "I don't know — well-known facts about 1720 and 'quoted' words.",
    'A plain sentence. Then another one! And a third?',
    'ALL CAPS SHOUTING here.',
  ];
  for (const p of paragraphs) {
    const spoken = toSentences(p).join(' ');
    expect(renderWordCount(p)).toBe(wordSpans(spoken).length);
  }
});
