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

/** Speak a word in American English (browser synthesis). Cancels any prior utterance. */
export function speakWord(word: string): void {
  if (!canSpeak()) return;
  cancelSpeech();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
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
 * "Whether the `boundary` event actually fires here" — Safari on iOS reports it in the
 * API but never emits it (no `charLength`), so we self-calibrate: the first passage that
 * gets zero boundary events flips this to false, and every later passage uses the
 * word-by-word fallback that highlights on each word's `start`. No UA sniffing.
 */
let boundaryWorks: boolean | 'unknown' = 'unknown';

/**
 * Read a passage aloud, calling `onWord(index)` as each word is spoken so the caller can
 * highlight it. Uses one natural utterance with `boundary` where that works, and falls
 * back to chained per-word utterances on engines (iOS Safari) where it does not.
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
  const rate = opts.rate ?? 1;

  const speakPerWord = () => {
    let i = 0;
    const next = () => {
      if (!alive()) return;
      if (i >= spans.length) {
        done();
        return;
      }
      const span = spans[i]!;
      const idx = i;
      const u = new SpeechSynthesisUtterance(text.slice(span.start, span.end));
      u.lang = 'en-US';
      u.rate = rate;
      u.onstart = () => {
        if (alive()) opts.onWord?.(idx);
      };
      u.onend = () => {
        i += 1;
        next();
      };
      u.onerror = () => {
        i += 1;
        next();
      };
      window.speechSynthesis.speak(u);
    };
    next();
  };

  if (boundaryWorks === false || spans.length === 0) {
    speakPerWord();
    return;
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  let sawBoundary = false;
  u.onboundary = (e: SpeechSynthesisEvent) => {
    if (!alive() || (e.name && e.name !== 'word')) return;
    sawBoundary = true;
    boundaryWorks = true;
    const at = e.charIndex;
    let idx = spans.findIndex((s) => at >= s.start && at < s.end);
    if (idx < 0) idx = spans.findIndex((s) => s.start >= at);
    if (idx >= 0) opts.onWord?.(idx);
  };
  u.onend = () => {
    if (!alive()) return;
    if (!sawBoundary && boundaryWorks === 'unknown') boundaryWorks = false;
    done();
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
