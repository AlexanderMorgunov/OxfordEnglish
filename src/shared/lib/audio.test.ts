import { test, expect } from 'vitest';
import {
  wordSpans,
  chunkPassage,
  wordAtElapsed,
  calibrateCps,
  WORD_SPLIT_RE,
  WORD_TEST_RE,
} from './audio';
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

// The boundary-less highlight estimate: `wordAtElapsed` drives it from real elapsed time, so a word
// lights the instant its estimated start is reached — no fixed baseline lag (the old ~220 ms bug).
test('wordAtElapsed highlights each word exactly when its estimated start is reached', () => {
  // "I am here." → I@0, am@2, here@5 chars; at 10 chars/s → 0s, 0.2s, 0.5s.
  const words = [
    { k: 0, at: 0 },
    { k: 1, at: 2 },
    { k: 2, at: 5 },
  ];
  expect(wordAtElapsed(words, 10, 0)).toBe(0); // first word at speech start, not +220ms
  expect(wordAtElapsed(words, 10, 0.1)).toBe(0);
  expect(wordAtElapsed(words, 10, 0.2)).toBe(1); // `am` lights right at 0.2s
  expect(wordAtElapsed(words, 10, 0.49)).toBe(1);
  expect(wordAtElapsed(words, 10, 0.5)).toBe(2);
  expect(wordAtElapsed(words, 10, 99)).toBe(2);
});

test('wordAtElapsed returns global indices, respects a leading gap, and -1 when empty', () => {
  expect(wordAtElapsed([], 10, 1)).toBe(-1);
  // A chunk whose first word starts at char 4 (leading gap): nothing until 0.4s.
  const words = [
    { k: 7, at: 4 },
    { k: 8, at: 9 },
  ];
  expect(wordAtElapsed(words, 10, 0.1)).toBe(-1);
  expect(wordAtElapsed(words, 10, 0.4)).toBe(7); // returns the GLOBAL span index, not the local one
  expect(wordAtElapsed(words, 10, 1)).toBe(8);
});

test('calibrateCps folds a clean sample toward the measured pace, normalised by rate', () => {
  // 100 chars in 6 s at rate 1 → 16.67 c/s; EMA 15*0.6 + 16.67*0.4.
  const next = calibrateCps(15, 100, 6, 1);
  expect(next).toBeCloseTo(15 * 0.6 + (100 / 6) * 0.4, 5);
  expect(next).toBeGreaterThan(15);
  // Same real pace at rate 1.25 (100 chars in 4.8 s) must normalise to the SAME EMA.
  expect(calibrateCps(15, 100, 4.8, 1.25)).toBeCloseTo(next, 5);
});

test('calibrateCps ignores unusable samples (short/cut/blank), so pause & cancel never poison it', () => {
  expect(calibrateCps(15, 100, 0.2, 1)).toBe(15); // too short
  expect(calibrateCps(15, 100, 0.5, 1)).toBe(15); // 200 c/s — a cancelled/cut chunk: absurd, ignored
  expect(calibrateCps(15, 0, 6, 1)).toBe(15); // no chars
  expect(calibrateCps(15, 100, 6, 0)).toBe(15); // no rate
});

test('calibrateCps clamps the EMA to a sane 6–40 band', () => {
  expect(calibrateCps(40, 590, 10, 1)).toBe(40); // 59 c/s sample can't push above 40
  expect(calibrateCps(6, 40, 10, 1)).toBe(6); // 4 c/s sample can't push below 6
});
