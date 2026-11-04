import { create } from 'zustand';
import { setPreferredVoiceURI } from '@/shared/lib/audio';
import { stampSetting } from '@/features/sync/local';
import { registerSettingBridge } from '@/features/sync/settingsBridge';
import { APPEARANCE_KEY, useTheme } from '@/features/appearance/themes';
import type { ThemeId } from '@/features/appearance/themes';

const KEY = 'oxford-reader-settings';
const SETTING_KEY = 'reader';

export const FONT_SIZES = [
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 28, 32, 34,
] as const;
export const FONT_CLASSES = [
  'text-[0.9375rem]',
  'text-[1rem]',
  'text-[1.0625rem]',
  'text-[1.125rem]',
  'text-[1.1875rem]',
  'text-[1.25rem]',
  'text-[1.3125rem]',
  'text-[1.375rem]',
  'text-[1.4375rem]',
  'text-[1.5rem]',
  'text-[1.75rem]',
  'text-[2rem]',
  'text-[2.125rem]',
] as const;
export const DEFAULT_FONT_STEP = 2;
export const DEFAULT_BOOK_FONT_STEP = 7;
export function effectiveReaderFontStep(
  fontStep: number,
  fontStepExplicit: boolean,
  book = false
): number {
  return book && !fontStepExplicit ? DEFAULT_BOOK_FONT_STEP : fontStep;
}
export const READER_FONT_FAMILIES = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: 'var(--font-body)',
} as const;
export const LEADING_CLASSES = ['leading-relaxed', 'leading-loose'] as const;
/**
 * Read-aloud playback-speed presets. Weighted below 1× on purpose: a learner slows speech down to
 * catch it, and rarely speeds up speech they are still decoding. The 1.25× ceiling matches the
 * recorded-audio players in the reading and listening sections.
 */
export const RATE_STEPS = [0.5, 0.75, 1, 1.25] as const;

export type BookmarkSort = 'recent' | 'book';

type Persisted = {
  coloring: boolean;
  fontStep: number;
  fontStepExplicit: boolean;
  fontScaleVersion: 2;
  fontFamily: keyof typeof READER_FONT_FAMILIES | null;
  lineStep: number;
  voiceURI: string | null;
  /** Read-aloud playback rate for passage narration (SpeechSynthesis `rate`). */
  rate: number;
  /** Translate reader sentences/phrases with the BYOK AI instead of the free (MyMemory) service. */
  aiTranslation: boolean;
  /** Per-sentence lens: EN→RU translate, or an AI same-language simplification at the learner's level. */
  lens: 'translate' | 'simplify' | 'grammar';
  bookmarkSort: BookmarkSort;
};

const DEFAULTS: Persisted = {
  coloring: true,
  fontStep: DEFAULT_FONT_STEP,
  fontStepExplicit: false,
  fontScaleVersion: 2,
  fontFamily: null,
  lineStep: 0,
  voiceURI: null,
  rate: 1,
  aiTranslation: false,
  lens: 'translate',
  bookmarkSort: 'recent',
};

const clampStep = (n: number, max: number) => Math.max(0, Math.min(n, max));
const clampFontStep = (n: unknown) =>
  typeof n === 'number' && Number.isFinite(n)
    ? clampStep(Math.round(n), FONT_CLASSES.length - 1)
    : DEFAULT_FONT_STEP;
/**
 * Snap to the nearest preset. Not just a clamp: a rate saved before the presets changed would
 * otherwise survive in storage with no button to match it, leaving the row with nothing selected
 * while narration ran at a speed the user could no longer see or undo.
 */
const clampRate = (n: number) => {
  const wanted = Number.isFinite(n) ? n : 1;
  return RATE_STEPS.reduce((best, step) =>
    Math.abs(step - wanted) < Math.abs(best - wanted) ? step : best
  );
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
    const merged = { ...DEFAULTS, ...stored };
    // Unversioned indices meant 15/17/21px; keep those sizes on the finer ladder.
    const legacyFontStep =
      stored.fontStep === 0
        ? 0
        : stored.fontStep === 1
          ? 2
          : stored.fontStep === 2
            ? 6
            : DEFAULT_FONT_STEP;
    return {
      ...merged,
      fontScaleVersion: 2,
      fontStepExplicit:
        typeof stored.fontStepExplicit === 'boolean'
          ? stored.fontStepExplicit
          : typeof stored.fontStep === 'number' &&
            Number.isFinite(stored.fontStep),
      fontFamily:
        merged.fontFamily === 'serif' || merged.fontFamily === 'sans'
          ? merged.fontFamily
          : null,
      coloring:
        typeof merged.coloring === 'boolean'
          ? merged.coloring
          : DEFAULTS.coloring,
      lineStep:
        typeof merged.lineStep === 'number' && Number.isFinite(merged.lineStep)
          ? clampStep(Math.round(merged.lineStep), LEADING_CLASSES.length - 1)
          : 0,
      voiceURI: typeof merged.voiceURI === 'string' ? merged.voiceURI : null,
      fontStep:
        stored.fontScaleVersion === 2
          ? clampFontStep(stored.fontStep)
          : stored.fontScaleVersion === undefined
            ? legacyFontStep
            : DEFAULT_FONT_STEP,
      rate: clampRate(merged.rate),
      bookmarkSort: merged.bookmarkSort === 'book' ? 'book' : 'recent',
    };
  } catch {
    return DEFAULTS;
  }
}

export type ReaderAppearanceValues = Pick<
  Persisted,
  | 'coloring'
  | 'fontStep'
  | 'fontStepExplicit'
  | 'fontFamily'
  | 'lineStep'
  | 'voiceURI'
>;
let appearanceBaseline: ReaderAppearanceValues | null = null;

function appearanceValues(state: Persisted): ReaderAppearanceValues {
  const {
    coloring,
    fontStep,
    fontStepExplicit,
    fontFamily,
    lineStep,
    voiceURI,
  } = state;
  return {
    coloring,
    fontStep,
    fontStepExplicit,
    fontFamily,
    lineStep,
    voiceURI,
  };
}

type ReaderSettings = Persisted & {
  storageError: boolean;
  beginAppearancePreview: () => void;
  cancelAppearancePreview: () => void;
  previewAppearance: (values: Partial<ReaderAppearanceValues>) => void;
  saveAppearance: (values: ReaderAppearanceValues, theme: ThemeId) => boolean;
  /** LingQ-style in-text word-status coloring in the book reader. */
  toggleColoring: () => void;
  setFontStep: (n: number) => void;
  setLineStep: (n: number) => void;
  /** Read-aloud voice by SpeechSynthesis voiceURI; null = auto-pick the best available. */
  setVoiceURI: (uri: string | null) => void;
  setRate: (n: number) => void;
  toggleAiTranslation: () => void;
  setLens: (lens: 'translate' | 'simplify' | 'grammar') => void;
  setBookmarkSort: (mode: BookmarkSort) => void;
};

export const useReaderSettings = create<ReaderSettings>((set, get) => {
  const initial = load();
  // Apply the saved voice to the audio layer at startup so all read-aloud honours it.
  setPreferredVoiceURI(initial.voiceURI);
  const persisted = (patch: Partial<Persisted>): Persisted => ({
    coloring: get().coloring,
    fontStep: get().fontStep,
    fontStepExplicit: get().fontStepExplicit,
    fontScaleVersion: 2,
    fontFamily: get().fontFamily,
    lineStep: get().lineStep,
    voiceURI: get().voiceURI,
    rate: get().rate,
    aiTranslation: get().aiTranslation,
    lens: get().lens,
    bookmarkSort: get().bookmarkSort,
    ...appearanceBaseline,
    ...patch,
  });
  const persist = (patch: Partial<Persisted>) => {
    const next = persisted(patch);
    let storageError = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      storageError = true;
    }
    set({ ...patch, storageError });
    if (appearanceBaseline) appearanceBaseline = appearanceValues(next);
    // Only the behavioral toggles sync; font/line/rate/voice are device preferences (like voiceURI).
    if ('coloring' in patch || 'aiTranslation' in patch) {
      void stampSetting(SETTING_KEY, {
        coloring: next.coloring,
        aiTranslation: next.aiTranslation,
      });
    }
  };
  return {
    ...initial,
    storageError: false,
    beginAppearancePreview: () => {
      appearanceBaseline = appearanceValues(get());
    },
    cancelAppearancePreview: () => {
      if (!appearanceBaseline) return;
      const previous = appearanceBaseline;
      appearanceBaseline = null;
      set(previous);
    },
    previewAppearance: (values) => set(values),
    saveAppearance: (values, theme) => {
      const previousColoring = appearanceBaseline?.coloring ?? get().coloring;
      const next = persisted(values);
      let previousReader: string | null = null;
      let previousTheme: string | null = null;
      let readerWritten = false;
      let themeWritten = false;
      try {
        previousReader = localStorage.getItem(KEY);
        previousTheme = localStorage.getItem(APPEARANCE_KEY);
        localStorage.setItem(KEY, JSON.stringify(next));
        readerWritten = true;
        localStorage.setItem(
          APPEARANCE_KEY,
          JSON.stringify({ theme, dismissed: true })
        );
        themeWritten = true;
      } catch {
        // A browser has no multi-key transaction. Restore only writes that completed.
        try {
          if (readerWritten) {
            if (previousReader === null) localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, previousReader);
          }
          if (themeWritten) {
            if (previousTheme === null) localStorage.removeItem(APPEARANCE_KEY);
            else localStorage.setItem(APPEARANCE_KEY, previousTheme);
          }
        } catch {
          /* Keep the draft and report failure even when storage rejects rollback. */
        }
        set({ storageError: true });
        return false;
      }
      set({ ...values, storageError: false });
      appearanceBaseline = null;
      setPreferredVoiceURI(values.voiceURI);
      useTheme.getState().preview(theme);
      useTheme.setState({ theme, dismissed: true, draft: null, error: false });
      if (values.coloring !== previousColoring) {
        void stampSetting(SETTING_KEY, {
          coloring: next.coloring,
          aiTranslation: next.aiTranslation,
        });
      }
      return true;
    },
    toggleColoring: () => persist({ coloring: !get().coloring }),
    setFontStep: (n) =>
      persist({ fontStep: clampFontStep(n), fontStepExplicit: true }),
    setLineStep: (n) =>
      persist({
        lineStep: Number.isFinite(n)
          ? clampStep(Math.round(n), LEADING_CLASSES.length - 1)
          : 0,
      }),
    setVoiceURI: (uri) => {
      setPreferredVoiceURI(uri);
      persist({ voiceURI: uri });
    },
    setRate: (n) => persist({ rate: clampRate(n) }),
    toggleAiTranslation: () => persist({ aiTranslation: !get().aiTranslation }),
    setLens: (lens) => persist({ lens }),
    setBookmarkSort: (bookmarkSort) => persist({ bookmarkSort }),
  };
});

/** Apply the synced reader toggles from another device (persists to localStorage without re-stamping). */
export function applyReaderFromSync(value: unknown): void {
  const v = value as { coloring?: unknown; aiTranslation?: unknown } | null;
  if (!v || typeof v !== 'object') return;
  const patch: Partial<Persisted> = {};
  if (typeof v.coloring === 'boolean') patch.coloring = v.coloring;
  if (typeof v.aiTranslation === 'boolean')
    patch.aiTranslation = v.aiTranslation;
  if (!Object.keys(patch).length) return;
  const s = useReaderSettings.getState();
  // Every Persisted field must be listed: the type makes an omission a compile error, which is how a
  // newly added setting (lens, bookmarkSort) gets caught here instead of being dropped on sync.
  const next: Persisted = {
    coloring: s.coloring,
    fontStep: s.fontStep,
    fontStepExplicit: s.fontStepExplicit,
    fontScaleVersion: 2,
    fontFamily: s.fontFamily,
    lineStep: s.lineStep,
    voiceURI: s.voiceURI,
    rate: s.rate,
    aiTranslation: s.aiTranslation,
    lens: s.lens,
    bookmarkSort: s.bookmarkSort,
    ...appearanceBaseline,
    ...patch,
  };
  if (appearanceBaseline) appearanceBaseline = appearanceValues(next);
  let storageError = false;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    storageError = true;
  }
  useReaderSettings.setState({ ...patch, storageError });
}

registerSettingBridge({
  key: SETTING_KEY,
  scope: 'device',
  applyFromSync: applyReaderFromSync,
});
