import { beforeEach, expect, test, vi } from 'vitest';

const load = async (value?: unknown) => {
  localStorage.removeItem('oxford-ui-text-size');
  if (value !== undefined) localStorage.setItem('oxford-ui-text-size', JSON.stringify(value));
  vi.resetModules();
  return import('./store');
};
beforeEach(() => document.documentElement.style.removeProperty('font-size'));

test.each([[undefined, 1], ['large', 1], [null, 1], [-3, 0], [99, 6], [2.8, 3]])('stored application text step %j normalizes to %i', async (value, step) => {
  const { useAppearance } = await load(value);
  expect(useAppearance.getState().textStep).toBe(step);
});

test('application preference persists without changing browser root size or reader preference', async () => {
  localStorage.setItem('oxford-reader-settings', JSON.stringify({ fontStep: 9, fontScaleVersion: 2 }));
  document.documentElement.style.fontSize = '32px';
  let store = await load();
  store.useAppearance.getState().setTextStep(6);
  expect(document.documentElement.style.getPropertyValue('--app-text-scale')).toBe('1.5');
  expect(document.documentElement.style.fontSize).toBe('32px');
  expect(JSON.parse(localStorage.getItem('oxford-reader-settings')!)).toEqual({ fontStep: 9, fontScaleVersion: 2 });
  vi.resetModules();
  store = await import('./store');
  expect(store.useAppearance.getState().textStep).toBe(6);
  store.useAppearance.getState().setTextStep(store.DEFAULT_UI_TEXT_STEP);
  expect(document.documentElement.style.getPropertyValue('--app-text-scale')).toBe('1');
});
