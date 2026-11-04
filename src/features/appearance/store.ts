import { create } from 'zustand';

export const UI_TEXT_SIZE_KEY = 'oxford-ui-text-size';
const KEY = UI_TEXT_SIZE_KEY;
export const UI_TEXT_SIZES = [90, 100, 110, 120, 130, 140, 150] as const;
export const DEFAULT_UI_TEXT_STEP = 1;
const normalize = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, Math.min(UI_TEXT_SIZES.length - 1, Math.round(value))) : DEFAULT_UI_TEXT_STEP;
const load = () => {
  try {
    const value = localStorage.getItem(KEY);
    return value === null ? DEFAULT_UI_TEXT_STEP : normalize(JSON.parse(value));
  } catch { return DEFAULT_UI_TEXT_STEP; }
};
const apply = (step: number) => document.documentElement.style.setProperty('--app-text-scale', String(UI_TEXT_SIZES[step]! / 100));
export const previewUiTextSize = (step: number) => apply(normalize(step));
const initial = load();
if (typeof document !== 'undefined') apply(initial);

export const useAppearance = create<{ textStep: number; storageError: boolean; setTextStep: (step: number) => void }>((set) => ({
  textStep: initial,
  storageError: false,
  setTextStep: step => {
    const next = normalize(step);
    let storageError = false;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { storageError = true; }
    apply(next);
    set({ textStep: next, storageError });
  },
}));

export function acceptUiTextSize(step: number, sessionOnly = false): void {
  const textStep = normalize(step);
  apply(textStep);
  useAppearance.setState({ textStep, storageError: sessionOnly });
}
