import { create } from 'zustand';

export const THEMES = [
  {
    id: 'paper',
    ru: 'Дневная',
    en: 'Daylight',
    noteRu: 'Тёплая и ясная',
    noteEn: 'Warm and clear',
    descriptionRu: 'Молочная бумага, чернильный текст и синий акцент.',
    descriptionEn: 'Cream paper, ink text and a blue accent.',
  },
  {
    id: 'lime',
    ru: 'Лайм',
    en: 'Lime',
    noteRu: 'Заряд на новый день',
    noteEn: 'A fresh start',
    descriptionRu: 'Свежий лаймовый фон и мягкие фиолетовые акценты.',
    descriptionEn: 'Fresh lime surfaces with soft violet accents.',
  },
  {
    id: 'bloom',
    ru: 'Пион',
    en: 'Peony',
    noteRu: 'Мягкая и цветочная',
    noteEn: 'Soft and floral',
    descriptionRu: 'Светлые розовые оттенки для спокойной практики.',
    descriptionEn: 'Light pink tones for a calm practice session.',
  },
  {
    id: 'lagoon',
    ru: 'Лагуна',
    en: 'Lagoon',
    noteRu: 'Свежая и спокойная',
    noteEn: 'Fresh and calm',
    descriptionRu: 'Прохладные мятные оттенки и глубокий зелёный акцент.',
    descriptionEn: 'Cool mint tones and a deep green accent.',
  },
  {
    id: 'studio',
    ru: 'Студия',
    en: 'Studio',
    noteRu: 'Знакомая тёмная',
    noteEn: 'The familiar dark theme',
    descriptionRu: 'Тёмный фон, светлый текст и тёплые акценты.',
    descriptionEn: 'Dark surfaces, light text and warm accents.',
  },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];
export const APPEARANCE_KEY = 'oxford-appearance';
export const isTheme = (value: unknown): value is ThemeId =>
  THEMES.some((t) => t.id === value);
type Preference = { theme: ThemeId; dismissed: boolean };
const fallback: Preference = { theme: 'studio', dismissed: false };
function load(): Preference {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(APPEARANCE_KEY) ?? 'null'
    );
    if (
      value &&
      typeof value === 'object' &&
      'theme' in value &&
      isTheme(value.theme)
    ) {
      return {
        theme: value.theme,
        dismissed: 'dismissed' in value && value.dismissed === true,
      };
    }
  } catch {
    /* Keep the previous dark appearance when storage is unavailable. */
  }
  return { ...fallback };
}
function paint(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    {
      paper: '#f6f3ed',
      lime: '#f6f8ee',
      bloom: '#fcf4f6',
      lagoon: '#eff7f5',
      studio: '#12141c',
    }[theme]
  );
}
function persist(value: Preference): boolean {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
const initial = load();
paint(initial.theme);
type AppearanceTheme = Preference & {
  draft: ThemeId | null;
  error: boolean;
  preview: (theme: ThemeId) => void;
  cancel: () => void;
  apply: () => boolean;
  dismiss: () => boolean;
};
export const useTheme = create<AppearanceTheme>((set, get) => ({
  ...initial,
  draft: null,
  error: false,
  preview: (theme) => {
    paint(theme);
    set({ draft: theme, error: false });
  },
  cancel: () => {
    paint(get().theme);
    set({ draft: null, error: false });
  },
  apply: () => {
    const theme = get().draft ?? get().theme;
    if (!persist({ theme, dismissed: true })) {
      set({ error: true });
      return false;
    }
    paint(theme);
    set({ theme, dismissed: true, draft: null, error: false });
    return true;
  },
  dismiss: () => {
    if (!persist({ theme: get().theme, dismissed: true })) return false;
    set({ dismissed: true });
    return true;
  },
}));

const storageChanged = (event: StorageEvent) => {
  if (event.key !== APPEARANCE_KEY && event.key !== null) return;
  const next = load();
  useTheme.setState(next);
  if (!useTheme.getState().draft) paint(next.theme);
};
window.addEventListener('storage', storageChanged);
if (import.meta.hot)
  import.meta.hot.dispose(() =>
    window.removeEventListener('storage', storageChanged)
  );
