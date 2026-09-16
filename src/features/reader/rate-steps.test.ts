import { test, expect, beforeEach, vi } from 'vitest';

const KEY = 'oxford-reader-settings';

// The store reads localStorage once at module load, so seeding has to happen before the import.
const loadWith = async (persisted: Record<string, unknown>) => {
  localStorage.setItem(KEY, JSON.stringify(persisted));
  vi.resetModules();
  return import('./settings');
};

beforeEach(() => localStorage.clear());

test('the presets are ordered, distinct, and weighted below normal speed', async () => {
  const { RATE_STEPS } = await import('./settings');
  expect([...RATE_STEPS]).toEqual([0.5, 0.75, 1, 1.25]);
  expect(new Set(RATE_STEPS).size).toBe(RATE_STEPS.length);
  expect(RATE_STEPS.filter((r) => r < 1)).toHaveLength(2);
});

// 1.5x was a preset until it stopped fitting the widget panel. Without snapping, anyone who had it
// selected would keep narrating at 1.5x with no button showing as pressed — a speed they could
// neither see nor return to.
test('a speed saved before the presets changed snaps to the nearest one that exists', async () => {
  const { useReaderSettings } = await loadWith({ rate: 1.5 });
  expect(useReaderSettings.getState().rate).toBe(1.25);
});

test('a nonsense stored speed falls back instead of reaching SpeechSynthesis', async () => {
  const { useReaderSettings } = await loadWith({ rate: 'fast' });
  expect(useReaderSettings.getState().rate).toBe(1);
});

test('setting a speed keeps it on the preset ladder', async () => {
  const { useReaderSettings } = await import('./settings');
  useReaderSettings.getState().setRate(0.5);
  expect(useReaderSettings.getState().rate).toBe(0.5);
  useReaderSettings.getState().setRate(3);
  expect(useReaderSettings.getState().rate).toBe(1.25);
});
