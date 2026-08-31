let current: HTMLAudioElement | null = null;

/** Bumped on every cancel/new utterance so stale speech callbacks bail out. */
let speechToken = 0;

function stopClip(): void {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
}

export const canSpeak = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Stop any ongoing browser speech and invalidate its pending callbacks. */
export function cancelSpeech(): void {
  speechToken += 1;
  if (canSpeak()) window.speechSynthesis.cancel();
}

/** Play one clip at a time — stops any previous clip so repeated clicks don't overlap. */
export function playClip(url: string, rate = 1): void {
  stopClip();
  cancelSpeech();
  const audio = new Audio(url);
  audio.playbackRate = rate;
  current = audio;
  void audio.play();
}

/** Play/resume a caller-owned <audio> element as the single active clip (stops any other clip or
 *  speech first). Unlike playClip it does NOT reset the element, so a paused paragraph resumes from
 *  where it stopped — the caller pauses with `el.pause()` and drives its own play/pause button. */
export function resumeExclusive(el: HTMLAudioElement, rate = 1): void {
  if (current && current !== el) stopClip();
  cancelSpeech();
  el.playbackRate = rate;
  current = el;
  void el.play();
}

let cachedVoice: SpeechSynthesisVoice | null | undefined;
/** A user-chosen voice (by voiceURI) overrides the auto-pick; null = auto. */
let preferredVoiceURI: string | null = null;

/** English (`en-*`) voices the browser exposes, for the reader's voice picker. */
export function listEnglishVoices(): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  return window.speechSynthesis.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
}

/** Set (or clear, with null) the preferred read-aloud voice; re-resolves on next utterance. */
export function setPreferredVoiceURI(uri: string | null): void {
  preferredVoiceURI = uri;
  cachedVoice = undefined;
}

/**
 * Pick the best available English voice. The browser default is often the plainest one;
 * modern engines ship far better "Natural/Neural" voices we can opt into. Prefer a local
 * voice among equals so read-aloud still works offline.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const en = listEnglishVoices();
  if (!en.length) return null;
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|enhanced|premium/i.test(v.name) ? 8 : 0) +
    (/google|microsoft|siri|samantha|aria|jenny|guy/i.test(v.name) ? 4 : 0) +
    (/en-US/i.test(v.lang) ? 2 : 0) +
    (v.localService ? 1 : 0);
  return [...en].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function resolveVoice(): SpeechSynthesisVoice | null {
  if (!canSpeak()) return null;
  if (preferredVoiceURI) {
    const chosen = window.speechSynthesis.getVoices().find((v) => v.voiceURI === preferredVoiceURI);
    if (chosen) return chosen;
  }
  return pickVoice();
}

function bestVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice === undefined) cachedVoice = resolveVoice();
  return cachedVoice ?? null;
}

/** Speak a reference line so the user can hear a specific voice before committing to it. */
export function previewVoice(voiceURI: string | null, text: string): void {
  if (!canSpeak()) return;
  cancelSpeech();
  const u = new SpeechSynthesisUtterance(text);
  const v = voiceURI
    ? window.speechSynthesis.getVoices().find((x) => x.voiceURI === voiceURI) ?? null
    : pickVoice();
  if (v) u.voice = v;
  u.lang = v?.lang ?? 'en-US';
  window.speechSynthesis.speak(u);
}

function applyVoice(u: SpeechSynthesisUtterance): void {
  const v = bestVoice();
  if (v) u.voice = v;
  u.lang = 'en-US';
}

/** Speak a word in American English (browser synthesis). Cancels any prior utterance. */
export function speakWord(word: string): void {
  if (!canSpeak()) return;
  cancelSpeech();
  const utterance = new SpeechSynthesisUtterance(word);
  applyVoice(utterance);
  window.speechSynthesis.speak(utterance);
}

export type WordSpan = { start: number; end: number };

/** The word-token pattern, shared by the reader's render tokenizer and the phrase selector
 *  (`phraseFromRange`) so a token's index means the same array slot in both. A "word" is a maximal run
 *  of letters/apostrophes ("don't", "'Tis"). */
export const WORD_SPLIT_RE = /([A-Za-z']+)/;
export const WORD_TEST_RE = /^[A-Za-z']+$/;

/** Abbreviations whose trailing period is NOT a sentence end ("Mr. Blood", "St. James"). Shared by
 *  the reader's sentence splitter (`toSentences`) and TTS chunking so neither treats them, nor a lone
 *  initial ("H. G. Wells"), as a boundary. Alternation source (no internal dots). */
export const ABBREVIATIONS =
  'Mr|Mrs|Ms|Mx|Dr|Prof|Rev|Fr|Sr|Jr|St|Gen|Col|Maj|Capt|Lt|Sgt|Cpl|Hon|Pres|Gov|Sen|Rep|Messrs|Mmes|vs|etc|cf|al|viz|esp|approx|No|Vol|Ch|Fig|pp|Ave|Rd|Blvd|Mt|Ft|Co|Inc|Ltd|Corp|Dept|Univ';

/** True if `s` ends in an abbreviation or a single-letter initial + period — i.e. its final period is
 *  not a real sentence end. */
const ABBR_END_RE = new RegExp(`(?:\\b(?:${ABBREVIATIONS})|\\b[A-Z])\\.$`);

/** Char offsets [start, end) of each spoken word — used to map speech position to a token. */
export function wordSpans(text: string): WordSpan[] {
  const spans: WordSpan[] = [];
  const re = /[A-Za-z']+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

/**
 * Split a passage into small, utterance-sized chunks for read-aloud. Chrome silently drops utterances
 * that are too long (and cuts any off after ~15s), so one big paragraph never plays — split at sentence
 * ends and hard-split any sentence still over `maxLen` at a space. Sentence-sized (not finer) keeps the
 * narration smooth. Each chunk carries its `offset` in the original text (chunks are contiguous slices);
 * a chunk ending in an abbreviation/initial ("Mr.", "H.") is merged forward so TTS never pauses mid-name.
 */
export function chunkPassage(text: string, maxLen = 160): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  const sentenceRe = /[^.!?…]*[.!?…]+["')\]»]*\s*|[^.!?…]+$/g;
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(text)) !== null) {
    const sentence = m[0];
    if (!sentence.trim()) continue;
    const base = m.index;
    if (sentence.length <= maxLen) {
      out.push({ text: sentence, offset: base });
      continue;
    }
    // A single sentence longer than maxLen: break it at spaces near the limit.
    let i = 0;
    while (i < sentence.length) {
      let end = Math.min(i + maxLen, sentence.length);
      if (end < sentence.length) {
        const sp = sentence.lastIndexOf(' ', end);
        if (sp > i) end = sp + 1;
      }
      const piece = sentence.slice(i, end);
      if (piece.trim()) out.push({ text: piece, offset: base + i });
      i = end;
    }
  }
  if (out.length === 0 && text.trim()) out.push({ text, offset: 0 });
  const merged: { text: string; offset: number }[] = [];
  for (const c of out) {
    const prev = merged[merged.length - 1];
    if (prev && ABBR_END_RE.test(prev.text.trim())) prev.text += c.text;
    else merged.push({ ...c });
  }
  return merged;
}

/**
 * Read a passage aloud one sentence-sized chunk at a time (sequential utterances — what lets a long
 * paragraph play at all). `onChunk(index)` fires from each chunk's `start` event so a pause can resume
 * from that chunk; `onEnd(nextChunk, total)` fires when speech stops naturally. To read a single
 * sentence, pass just that sentence as `text`.
 */
export function speakPassage(
  text: string,
  opts: {
    rate?: number;
    startChunk?: number;
    onChunk?: (index: number) => void;
    onEnd?: (nextChunk: number, totalChunks: number) => void;
  } = {}
): void {
  const chunks = chunkPassage(text);
  const done = (next: number) => opts.onEnd?.(next, chunks.length);
  if (!canSpeak()) {
    done(chunks.length);
    return;
  }
  stopClip();
  cancelSpeech();
  const myToken = speechToken;
  const alive = () => myToken === speechToken;
  const rate = opts.rate ?? 1;

  let ci = Math.min(Math.max(0, Math.floor(opts.startChunk ?? 0)), chunks.length);
  const speakNext = () => {
    if (!alive()) return;
    if (ci >= chunks.length) {
      done(chunks.length);
      return;
    }
    const myChunk = ci;
    ci += 1;
    const u = new SpeechSynthesisUtterance(chunks[myChunk]!.text);
    applyVoice(u);
    u.rate = rate;
    // Report the chunk from its real `start` (not at enqueue) so a pause resumes from the right chunk.
    u.onstart = () => {
      if (alive()) opts.onChunk?.(myChunk);
    };
    // Advance on end; on error, skip the failed chunk rather than stall the whole read.
    const advance = () => {
      if (!alive()) return;
      speakNext();
    };
    u.onend = advance;
    u.onerror = advance;
    window.speechSynthesis.speak(u);
  };
  speakNext();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    stopClip();
    cancelSpeech();
  });
}

// Voices load asynchronously in most browsers; re-resolve once they arrive.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    cachedVoice = resolveVoice();
  });
}
