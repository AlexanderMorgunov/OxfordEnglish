import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import {
  APPEARANCE_KEY,
  acceptTheme,
  useTheme,
} from '@/features/appearance/themes';
import {
  UI_TEXT_SIZE_KEY,
  acceptUiTextSize,
  useAppearance,
  previewUiTextSize,
} from '@/features/appearance/store';
import { initializeNewTheme, saveWelcomePreferences } from './preferences';
import { WELCOME_KEY } from './memory';
beforeEach(() => {
  localStorage.clear();
  acceptTheme('studio', false);
  acceptUiTextSize(1);
});
afterEach(() => {
  vi.restoreAllMocks();
});
test('successful appearance commit uses the real keys and both stores', () => {
  expect(saveWelcomePreferences('bloom', 3)).toBe(true);
  expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual({
    theme: 'bloom',
    dismissed: true,
  });
  expect(localStorage.getItem(UI_TEXT_SIZE_KEY)).toBe('3');
  expect(localStorage.getItem(WELCOME_KEY)).toBe('seen');
  expect(useTheme.getState().theme).toBe('bloom');
  expect(useAppearance.getState().textStep).toBe(3);
});
test('partial write failure rolls back old preferences and leaves committed stores unchanged', () => {
  const previous = JSON.stringify({ theme: 'studio', dismissed: false });
  localStorage.setItem(APPEARANCE_KEY, previous);
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key,
    value
  ) {
    if (key === UI_TEXT_SIZE_KEY)
      throw new DOMException('Quota', 'QuotaExceededError');
    set.call(this, key, value);
  });
  useTheme.getState().preview('bloom');
  previewUiTextSize(3);
  expect(saveWelcomePreferences('bloom', 3)).toBe(false);
  expect(localStorage.getItem(APPEARANCE_KEY)).toBe(previous);
  expect(localStorage.getItem(WELCOME_KEY)).toBeNull();
  expect(useTheme.getState().theme).toBe('studio');
  expect(useAppearance.getState().textStep).toBe(1);
  useTheme.getState().cancel();
  previewUiTextSize(useAppearance.getState().textStep);
  expect(document.documentElement.dataset.theme).toBe('studio');
  expect(
    document.documentElement.style.getPropertyValue('--app-text-scale')
  ).toBe('1');
});
test('session-only continuation makes no persistence claim or writes', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem');
  expect(saveWelcomePreferences('lagoon', 2, true)).toBe(true);
  expect(write).not.toHaveBeenCalled();
  expect(useTheme.getState().theme).toBe('lagoon');
  expect(useAppearance.getState().storageError).toBe(true);
});
test('new Daylight default never replaces saved appearance', () => {
  initializeNewTheme();
  expect(useTheme.getState().theme).toBe('paper');
  saveWelcomePreferences('bloom', 2);
  initializeNewTheme();
  expect(useTheme.getState().theme).toBe('bloom');
});
