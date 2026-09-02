import { create } from 'zustand';
import type { LocalizedText } from '@/content/schema';
import { stampSetting } from '@/features/sync/local';
import { registerSettingBridge } from '@/features/sync/settingsBridge';

export type UiLang = 'en' | 'ru';

const KEY = 'oxford-ui-lang';
const SETTING_KEY = 'ui';

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
    void stampSetting(SETTING_KEY, { lang });
  },
}));

/** Apply a UI language synced from another device (persists without re-stamping). */
export function applyUiLangFromSync(value: unknown): void {
  const lang = (value as { lang?: unknown } | null)?.lang;
  if (lang !== 'en' && lang !== 'ru') return;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // ignore storage failures
  }
  useUiLang.setState({ lang });
}

registerSettingBridge({ key: SETTING_KEY, applyFromSync: applyUiLangFromSync });

/** Pick a localized string for the current UI language, falling back to English. */
export function tr(text: LocalizedText, lang: UiLang): string {
  return lang === 'ru' ? (text.ru ?? text.en) : text.en;
}
