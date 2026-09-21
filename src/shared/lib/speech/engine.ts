/**
 * The speech surface the app talks to, so read-aloud can outlive the platform it was written for.
 *
 * `speechSynthesis` does not exist in the Android WebView — measured, not inferred — so the Capacitor
 * build needs a native engine behind this same shape. Everything here is synchronous because the
 * callers are: `available()` is read inside JSX in a dozen places, and a picker renders `voices()`
 * directly. An async engine hides its latency behind a cache rather than leaking promises upward.
 */

/**
 * A voice, owned by us rather than borrowed from the DOM.
 *
 * Structurally what `SpeechSynthesisVoice` is, but the native plugin returns its own object of the
 * same shape, and annotating either with the DOM type only compiles by luck.
 */
export type Voice = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

export type SpeakHandlers = {
  rate?: number;
  /** Fires when the utterance actually begins, which is what a resume point must be taken from. */
  onStart?: () => void;
  onEnd?: () => void;
  /** An engine that fails one utterance must not stall the passage; callers advance on this. */
  onError?: () => void;
};

export interface SpeechEngine {
  available(): boolean;
  /** English voices only — every caller wants that subset, and the native index lives elsewhere. */
  englishVoices(): Voice[];
  /** null restores automatic selection. */
  setPreferredVoiceURI(uri: string | null): void;
  speak(text: string, handlers: SpeakHandlers): void;
  /** Speak with one specific voice, ignoring the stored preference — for auditioning a voice. */
  preview(text: string, voiceURI: string | null): void;
  cancel(): void;
  isSpeaking(): boolean;
  /** Voices arrive asynchronously on every platform; returns an unsubscribe. */
  subscribeVoices(onChange: () => void): () => void;
}

/**
 * Used where there is no synthesis at all: jsdom, and a WebView before a native engine is wired.
 * Callers already handle `available() === false` by reporting the passage as finished, so silence
 * here is the correct behaviour rather than a stub to be filled in.
 */
export const silentEngine: SpeechEngine = {
  available: () => false,
  englishVoices: () => [],
  setPreferredVoiceURI: () => undefined,
  speak: () => undefined,
  preview: () => undefined,
  cancel: () => undefined,
  isSpeaking: () => false,
  subscribeVoices: () => () => undefined,
};
