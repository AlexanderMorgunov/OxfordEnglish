import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { APPEARANCE_KEY, useTheme } from './themes';

beforeEach(() => {
  localStorage.removeItem(APPEARANCE_KEY);
  useTheme.setState({
    theme: 'studio',
    draft: null,
    dismissed: false,
    error: false,
  });
  useTheme.getState().cancel();
});
afterEach(() => vi.restoreAllMocks());

test('preview is reversible and never writes a preference or reader settings', () => {
  localStorage.setItem('oxford-reader-settings', 'reader-unchanged');
  useTheme.getState().preview('paper');
  expect(document.documentElement.dataset.theme).toBe('paper');
  expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull();
  useTheme.getState().cancel();
  expect(document.documentElement.dataset.theme).toBe('studio');
  expect(localStorage.getItem('oxford-reader-settings')).toBe(
    'reader-unchanged'
  );
});

test('failed apply keeps the draft and saved preference intact, and can retry', () => {
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
  useTheme.getState().preview('bloom');
  expect(useTheme.getState().apply()).toBe(false);
  expect(useTheme.getState()).toMatchObject({
    theme: 'studio',
    draft: 'bloom',
    dismissed: false,
    error: true,
  });
  write.mockRestore();
  expect(useTheme.getState().apply()).toBe(true);
  expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual({
    theme: 'bloom',
    dismissed: true,
  });
  useTheme.getState().cancel();
  expect(document.documentElement.dataset.theme).toBe('bloom');
});

test('a change in another tab is respected when cancelling the local preview', () => {
  useTheme.getState().preview('paper');
  localStorage.setItem(
    APPEARANCE_KEY,
    JSON.stringify({ theme: 'lagoon', dismissed: true })
  );
  window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY }));
  expect(document.documentElement.dataset.theme).toBe('paper');
  useTheme.getState().cancel();
  expect(document.documentElement.dataset.theme).toBe('lagoon');
});

test.each(['bad json', 'null', '{"theme":"unknown"}', '{"theme":1}'])(
  'corrupt storage %s falls back safely',
  (value) => {
    localStorage.setItem(APPEARANCE_KEY, value);
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY }));
    expect(useTheme.getState().theme).toBe('studio');
  }
);

test('dismissing is persisted independently, and storage denial is not success', () => {
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('denied');
    });
  expect(useTheme.getState().dismiss()).toBe(false);
  expect(useTheme.getState().dismissed).toBe(false);
  write.mockRestore();
  expect(useTheme.getState().dismiss()).toBe(true);
  expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual({
    theme: 'studio',
    dismissed: true,
  });
});
