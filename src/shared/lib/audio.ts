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
 * Read a passage aloud as ONE natural utterance, calling `onWord(index)` as each word is
 * spoken (via `boundary` events) so the caller can highlight it. Where `boundary` does not
 * fire — Safari on iOS reports the event but never emits it — the audio still plays
 * naturally; only the live highlight is absent. We never chop the text into per-word
 * utterances: natural speech matters more for listening-while-reading than the highlight.
 */
export function speakPassage(
  text: string,
  opts: { rate?: number; onWord?: (index: number) => void; onEnd?: () => void } = {}
): void {
  const done = () => opts.onEnd?.();
  if (!canSpeak()) {
    done();
    return;
  }
  stopClip();
  cancelSpeech();
  const myToken = speechToken;
  const alive = () => myToken === speechToken;
  const spans = wordSpans(text);

  const u = new SpeechSynthesisUtterance(text);
  applyVoice(u);
  u.rate = opts.rate ?? 1;
  u.onboundary = (e: SpeechSynthesisEvent) => {
    if (!alive() || (e.name && e.name !== 'word')) return;
    const at = e.charIndex;
    let idx = spans.findIndex((s) => at >= s.start && at < s.end);
    if (idx < 0) idx = spans.findIndex((s) => s.start >= at);
    if (idx >= 0) opts.onWord?.(idx);
  };
  u.onend = () => {
    if (alive()) done();
  };
  u.onerror = () => {
    if (alive()) done();
  };
  window.speechSynthesis.speak(u);
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
