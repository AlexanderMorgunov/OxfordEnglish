import { test, expect } from 'vitest';
import { wordSpans, chunkPassage, chunkWordRanges, WORD_SPLIT_RE, WORD_TEST_RE } from './audio';
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
    "Mr. Blood's attention was divided. Dr. Watson and H. G. Wells agreed.",
  ];
  for (const p of paragraphs) {
    const spoken = toSentences(p).join(' ');
    expect(renderWordCount(p)).toBe(wordSpans(spoken).length);
  }
});

// The read-aloud highlight advances one CHUNK per `start` event. The chunk word-ranges MUST tile the
// whole word list — a gap = permanently unhighlighted words, an overlap = double-highlight — and must
// line up 1:1 with the rendered word count (renderWordCount below).
test('chunkWordRanges tile [0, wordCount) with no gap or overlap', () => {
  const texts = [
    'Peter Blood smoked a pipe. He tended the geraniums. All Bridgewater was in arms.',
    "Mr. Blood's attention was divided. Dr. Watson agreed, and left.",
    'A single clause, then more, and yet more — right to the end.',
    "'Tis a fine morning. 'Go,' she said. Now.",
    `${'word '.repeat(120).trim()}.`, // one long sentence that chunkPassage hard-splits
  ];
  for (const text of texts) {
    const ranges = chunkWordRanges(text);
    const total = wordSpans(text).length;
    expect(ranges[0]!.from).toBe(0);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.from).toBe(ranges[i - 1]!.to);
    expect(ranges[ranges.length - 1]!.to).toBe(total);
    // Ranges are ordered and non-decreasing (a word-less chunk yields an empty from===to range).
    for (const r of ranges) expect(r.to).toBeGreaterThanOrEqual(r.from);
  }
});

test('toSentences does not split after abbreviations or initials', () => {
  // The reported bug: "Mr." became its own sentence before a capitalised name.
  expect(toSentences("His attention wandered. Mr. Blood's task was hard.")).toEqual([
    'His attention wandered.',
    "Mr. Blood's task was hard.",
  ]);
  expect(toSentences('She saw Dr. Watson and Mrs. Hudson leave. They walked on.')).toEqual([
    'She saw Dr. Watson and Mrs. Hudson leave.',
    'They walked on.',
  ]);
  expect(toSentences('He lived on St. James Street. It was quiet.')).toEqual([
    'He lived on St. James Street.',
    'It was quiet.',
  ]);
  // Single-letter initials stay with their name.
  expect(toSentences('The author was H. G. Wells. Everyone knew him.')).toEqual([
    'The author was H. G. Wells.',
    'Everyone knew him.',
  ]);
  // Real boundaries still split.
  expect(toSentences('He smoked a pipe. He tended the geraniums.')).toEqual([
    'He smoked a pipe.',
    'He tended the geraniums.',
  ]);
});

test('chunkPassage merges an abbreviation/initial chunk into the next (no mid-name TTS pause)', () => {
  const text = "His attention wandered. Mr. Blood's task was hard.";
  const chunks = chunkPassage(text);
  expect(chunks.map((c) => c.text.trim())).toEqual([
    'His attention wandered.',
    "Mr. Blood's task was hard.",
  ]);
  for (const c of chunks) expect(text.slice(c.offset, c.offset + c.text.length)).toBe(c.text);
});
