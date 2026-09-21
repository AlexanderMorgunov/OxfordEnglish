import type { SpeakHandlers, SpeechEngine, Voice } from './engine';

/**
 * Browser synthesis. A verbatim move of what shipped before the engines were split — deliberately so,
 * because it is the implementation four tests pin down and the one every web user is already hearing.
 */

let cachedVoice: SpeechSynthesisVoice | null | undefined;
let preferredVoiceURI: string | null = null;
let speaking = false;

/** Read through `window` on every call: a test stubs `speechSynthesis` after this module is imported. */
const synth = (): SpeechSynthesis | null =>
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

const isEnglish = (v: SpeechSynthesisVoice) => /^en([-_]|$)/i.test(v.lang);

function nativeVoices(): SpeechSynthesisVoice[] {
  return synth()?.getVoices() ?? [];
}

/**
 * Pick the best available English voice. The browser default is often the plainest one; modern engines
 * ship far better "Natural/Neural" voices we can opt into. Prefer a local voice among equals so
 * read-aloud still works offline.
 */
function pickVoice(): SpeechSynthesisVoice | null {
  const en = nativeVoices().filter(isEnglish);
  if (!en.length) return null;
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|enhanced|premium/i.test(v.name) ? 8 : 0) +
    (/google|microsoft|siri|samantha|aria|jenny|guy/i.test(v.name) ? 4 : 0) +
    (/en-US/i.test(v.lang) ? 2 : 0) +
    (v.localService ? 1 : 0);
  return [...en].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function resolveVoice(): SpeechSynthesisVoice | null {
  if (!synth()) return null;
  if (preferredVoiceURI) {
    const chosen = nativeVoices().find((v) => v.voiceURI === preferredVoiceURI);
    if (chosen) return chosen;
  }
  return pickVoice();
}

function bestVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice === undefined) cachedVoice = resolveVoice();
  return cachedVoice ?? null;
}

const toVoice = (v: SpeechSynthesisVoice): Voice => ({
  voiceURI: v.voiceURI,
  name: v.name,
  lang: v.lang,
  localService: v.localService,
  default: v.default,
});

function utter(text: string, voice: SpeechSynthesisVoice | null, h: SpeakHandlers, lang = 'en-US'): void {
  const s = synth();
  if (!s) return;
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = lang;
  if (h.rate !== undefined) u.rate = h.rate;
  u.onstart = () => {
    speaking = true;
    h.onStart?.();
  };
  u.onend = () => {
    speaking = false;
    h.onEnd?.();
  };
  u.onerror = () => {
    speaking = false;
    h.onError?.();
  };
  s.speak(u);
}

export const webEngine: SpeechEngine = {
  available: () => synth() !== null,

  englishVoices: () => nativeVoices().filter(isEnglish).map(toVoice),

  setPreferredVoiceURI(uri) {
    preferredVoiceURI = uri;
    cachedVoice = undefined;
  },

  speak(text, handlers) {
    utter(text, bestVoice(), handlers);
  },

  preview(text, voiceURI) {
    const v = voiceURI ? nativeVoices().find((x) => x.voiceURI === voiceURI) ?? null : pickVoice();
    utter(text, v, {}, v?.lang ?? 'en-US');
  },

  cancel() {
    speaking = false;
    synth()?.cancel();
  },

  // `speechSynthesis.speaking` stays true through a cancel in some builds, so track it from the events.
  isSpeaking: () => speaking,

  subscribeVoices(onChange) {
    const s = synth();
    if (!s?.addEventListener) return () => undefined;
    const handler = () => {
      cachedVoice = resolveVoice();
      onChange();
    };
    s.addEventListener('voiceschanged', handler);
    return () => s.removeEventListener('voiceschanged', handler);
  },
};
