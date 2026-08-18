import { create } from 'zustand';
import type { LocalizedText } from '@/content/schema';

export type UiLang = 'en' | 'ru';

const KEY = 'oxford-ui-lang';

function load(): UiLang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

type UiLangState = {
  lang: UiLang;
  setLang: (lang: UiLang) => void;
};

export const useUiLang = create<UiLangState>((set) => ({
  lang: load(),
  setLang: (lang) => {
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // ignore storage failures
    }
    set({ lang });
  },
}));

/** Pick a localized string for the current UI language, falling back to English. */
export function tr(text: LocalizedText, lang: UiLang): string {
  return lang === 'ru' ? (text.ru ?? text.en) : text.en;
}
