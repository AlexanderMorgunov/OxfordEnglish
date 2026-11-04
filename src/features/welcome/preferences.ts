import {
  APPEARANCE_KEY,
  acceptTheme,
  useTheme,
} from '@/features/appearance/themes';
import type { ThemeId } from '@/features/appearance/themes';
import {
  UI_TEXT_SIZE_KEY,
  acceptUiTextSize,
} from '@/features/appearance/store';
import { WELCOME_KEY } from './memory';

export function saveWelcomePreferences(
  theme: ThemeId,
  textStep: number,
  sessionOnly = false
): boolean {
  if (!sessionOnly) {
    const values: [string, string][] = [
      [APPEARANCE_KEY, JSON.stringify({ theme, dismissed: true })],
      [UI_TEXT_SIZE_KEY, JSON.stringify(textStep)],
      [WELCOME_KEY, 'seen'],
    ];
    const before = new Map<string, string | null>();
    const written: string[] = [];
    try {
      for (const [key] of values) before.set(key, localStorage.getItem(key));
      for (const [key, value] of values) {
        localStorage.setItem(key, value);
        written.push(key);
      }
    } catch {
      for (const key of written.reverse()) {
        try {
          const old = before.get(key);
          if (old == null) localStorage.removeItem(key);
          else localStorage.setItem(key, old);
        } catch {
          /* Retry can repair unavailable storage. */
        }
      }
      return false;
    }
  }
  acceptTheme(theme, true);
  acceptUiTextSize(textStep, sessionOnly);
  return true;
}

export function initializeNewTheme(): void {
  try {
    if (localStorage.getItem(APPEARANCE_KEY) !== null) return;
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ theme: 'paper', dismissed: true })
    );
    acceptTheme('paper', true);
  } catch {
    useTheme.getState().cancel();
  }
}
