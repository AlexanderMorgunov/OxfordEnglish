/**
 * What actually reaches the voice, and — just as important — what does NOT reach the chunker.
 *
 * Chunks carry their offset into the original text and the reader highlights the sentence being read by
 * it, so cleaning the passage before it is split would slide every offset and walk the highlight off the
 * words. The cleaning belongs to the utterance alone.
 */
import { vi, test, expect, beforeEach, afterEach } from 'vitest';
import { speakPassage } from './audio';

type Spoken = { text: string; onstart?: () => void; onend?: () => void; onerror?: () => void };
let spoken: Spoken[] = [];

class FakeUtterance {
  onstart?: () => void;
  onend?: () => void;
  onerror?: () => void;
  voice: unknown = null;
  lang = '';
  rate = 1;
  constructor(public text: string) {}
}

beforeEach(() => {
  spoken = [];
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [],
    cancel: () => undefined,
    // Each utterance runs to completion immediately, so a passage plays through in one tick.
    speak: (u: Spoken) => {
      spoken.push(u);
      u.onstart?.();
      u.onend?.();
    },
  });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: globalThis.speechSynthesis });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('the voice is given the sentence without the marks it would pronounce', () => {
  speakPassage('“So it goes,” he said. I felt… dizzy.');

  // Three, not two: the chunker already treats `…` as a sentence end, so the pause was there before —
  // what changes is that the voice no longer reads the mark aloud as "dot dot dot".
  expect(spoken.map((u) => u.text)).toEqual(['So it goes, he said.', 'I felt,', 'dizzy.']);
});

test('the chunks the reader highlights by are counted from the ORIGINAL text', () => {
  const seen: number[] = [];
  // Two sentences, the first of which is nothing but marks once cleaned. Cleaning before the split
  // would merge or drop it, and every chunk index after it would point at the wrong sentence.
  speakPassage('“…” Then he left.', { onChunk: (i) => seen.push(i) });

  expect(seen).toEqual([0, 1]);
  expect(spoken.map((u) => u.text)).toEqual(['Then he left.']);
});

test('a chunk with nothing sayable is skipped rather than stalling the read', () => {
  const ended: number[] = [];
  // Some engines never fire an end event for a punctuation-only utterance; handing them one would leave
  // the passage stuck on it forever.
  speakPassage('*** Then he left.', { onEnd: (next) => ended.push(next) });

  expect(spoken.every((u) => /[a-z]/i.test(u.text))).toBe(true);
  expect(ended.length).toBe(1);
});

test('ordinary prose reaches the voice unchanged', () => {
  speakPassage('The gong rang twice.');

  expect(spoken.map((u) => u.text)).toEqual(['The gong rang twice.']);
});
