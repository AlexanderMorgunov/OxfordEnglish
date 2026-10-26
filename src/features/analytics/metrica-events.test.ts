import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_YANDEX_METRICA_ID', '12345');
  localStorage.removeItem('analytics.optOut');
  Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
  window.ym = vi.fn();
});
afterEach(() => { vi.unstubAllEnvs(); delete window.ym; });

test.each(['onboarding_completed', 'onboarding_skipped', 'practice_answered', 'book_open', 'word_saved', 'phrase_saved', 'review_session_completed', 'text_translate_free_success', 'text_translate_ai_success', 'trial_started'])('forwards %s without private event properties or a custom collector', async event => {
  const { track } = await import('./analytics');
  await track(event, { word: 'private fixture', text: 'private fixture', accountId: 'private fixture' });
  expect(window.ym).toHaveBeenCalledExactlyOnceWith(12345, 'reachGoal', event);
});

test.each(['opt-out', 'DNT'] as const)('%s blocks new and old goals', async choice => {
  const { track } = await import('./analytics');
  if (choice === 'opt-out') localStorage.setItem('analytics.optOut', '1');
  else Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
  await track('word_saved'); await track('day_complete');
  expect(window.ym).not.toHaveBeenCalled();
});

test('unknown events and missing counter do not emit goals', async () => {
  vi.stubEnv('VITE_YANDEX_METRICA_ID', '');
  const { track } = await import('./analytics');
  await track('word_saved'); await track('arbitrary_private_event');
  expect(window.ym).not.toHaveBeenCalled();
});

test('a broken third-party tag cannot reject a product action', async () => {
  window.ym = vi.fn(() => { throw new Error('Synthetic tag failure'); });
  const { track } = await import('./analytics');
  await expect(track('word_saved')).resolves.toBeUndefined();
});
