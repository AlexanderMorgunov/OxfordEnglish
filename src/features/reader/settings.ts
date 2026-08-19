import { create } from 'zustand';

const KEY = 'oxford-reader-settings';

export const FONT_CLASSES = ['text-base', 'text-lg', 'text-xl'] as const;
export const LEADING_CLASSES = ['leading-relaxed', 'leading-loose'] as const;

type Persisted = { coloring: boolean; fontStep: number; lineStep: number };

const DEFAULTS: Persisted = { coloring: true, fontStep: 1, lineStep: 0 };

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(n, max));

type ReaderSettings = Persisted & {
  /** LingQ-style in-text word-status coloring in the book reader. */
  toggleColoring: () => void;
  setFontStep: (n: number) => void;
  setLineStep: (n: number) => void;
};

export const useReaderSettings = create<ReaderSettings>((set, get) => {
  const persist = (patch: Partial<Persisted>) => {
    const next = { coloring: get().coloring, fontStep: get().fontStep, lineStep: get().lineStep, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore storage failures
    }
    set(patch);
  };
  return {
    ...load(),
    toggleColoring: () => persist({ coloring: !get().coloring }),
    setFontStep: (n) => persist({ fontStep: clamp(n, FONT_CLASSES.length - 1) }),
    setLineStep: (n) => persist({ lineStep: clamp(n, LEADING_CLASSES.length - 1) }),
  };
});
