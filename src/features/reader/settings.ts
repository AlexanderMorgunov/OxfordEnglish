import { create } from 'zustand';
import { setPreferredVoiceURI } from '@/shared/lib/audio';

const KEY = 'oxford-reader-settings';

export const FONT_CLASSES = ['text-base', 'text-lg', 'text-xl'] as const;
export const LEADING_CLASSES = ['leading-relaxed', 'leading-loose'] as const;

type Persisted = {
  coloring: boolean;
  fontStep: number;
  lineStep: number;
  voiceURI: string | null;
  /** Read-aloud playback rate for passage narration (SpeechSynthesis `rate`). */
  rate: number;
  /** Translate reader sentences/phrases with the BYOK AI instead of the free (MyMemory) service. */
  aiTranslation: boolean;
  /** Per-sentence lens: EN→RU translate, or an AI same-language simplification at the learner's level. */
  lens: 'translate' | 'simplify';
};

const DEFAULTS: Persisted = {
  coloring: true,
  fontStep: 1,
  lineStep: 0,
  voiceURI: null,
  rate: 1,
  aiTranslation: false,
  lens: 'translate',
};

const clampStep = (n: number, max: number) => Math.max(0, Math.min(n, max));
/** SpeechSynthesis rate must stay usable across engines; clamp to a sane two-sided range. */
const clampRate = (n: number) => Math.max(0.5, Math.min(2, Number.isFinite(n) ? n : 1));

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    const merged = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) } : DEFAULTS;
    return { ...merged, rate: clampRate(merged.rate) };
  } catch {
    return DEFAULTS;
  }
}

type ReaderSettings = Persisted & {
  /** LingQ-style in-text word-status coloring in the book reader. */
  toggleColoring: () => void;
  setFontStep: (n: number) => void;
  setLineStep: (n: number) => void;
  /** Read-aloud voice by SpeechSynthesis voiceURI; null = auto-pick the best available. */
  setVoiceURI: (uri: string | null) => void;
  setRate: (n: number) => void;
  toggleAiTranslation: () => void;
  setLens: (lens: 'translate' | 'simplify') => void;
};

export const useReaderSettings = create<ReaderSettings>((set, get) => {
  const initial = load();
  // Apply the saved voice to the audio layer at startup so all read-aloud honours it.
  setPreferredVoiceURI(initial.voiceURI);
  const persist = (patch: Partial<Persisted>) => {
    // Annotated Persisted so adding a future field is a compile error until it's enumerated here —
    // otherwise persist() would silently drop it, reverting the user's choice on next load.
    const next: Persisted = {
      coloring: get().coloring,
      fontStep: get().fontStep,
      lineStep: get().lineStep,
      voiceURI: get().voiceURI,
      rate: get().rate,
      aiTranslation: get().aiTranslation,
      lens: get().lens,
      ...patch,
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
    set(patch);
  };
  return {
    ...initial,
    toggleColoring: () => persist({ coloring: !get().coloring }),
    setFontStep: (n) => persist({ fontStep: clampStep(n, FONT_CLASSES.length - 1) }),
    setLineStep: (n) => persist({ lineStep: clampStep(n, LEADING_CLASSES.length - 1) }),
    setVoiceURI: (uri) => {
      setPreferredVoiceURI(uri);
      persist({ voiceURI: uri });
    },
    setRate: (n) => persist({ rate: clampRate(n) }),
    toggleAiTranslation: () => persist({ aiTranslation: !get().aiTranslation }),
    setLens: (lens) => persist({ lens }),
  };
});
