import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startTour } from './tour';
import { track } from '@/features/analytics/analytics';

const state = vi.hoisted(() => ({ index: 0, options: null as { steps: unknown[]; onNextClick: () => void; onDestroyed: () => void; onDestroyStarted: () => void } | null }));
vi.mock('driver.js', () => ({ driver: (options: NonNullable<typeof state.options>) => {
  state.options = options;
  return { drive: () => {}, getActiveIndex: () => state.index, moveNext: () => { state.index += 1; }, destroy: () => options.onDestroyed() };
} }));
vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));
beforeEach(() => {
  vi.mocked(track).mockClear(); state.index = 0; state.options = null;
  document.body.innerHTML = '<div data-tour="start"></div><div data-tour="nav-review"></div><div data-tour="nav-library"></div>';
});
afterEach(() => { document.body.innerHTML = ''; });

test('reaching the last step and dismissing is a skip, not completion', () => {
  startTour('en');
  state.index = 2; state.options?.onDestroyed();
  expect(vi.mocked(track).mock.calls).toEqual([['onboarding_start'], ['onboarding_end', { completed: false }], ['onboarding_skipped']]);
});

test('only the explicit final Done action completes onboarding', () => {
  startTour('en');
  state.options?.onNextClick(); state.options?.onNextClick();
  expect(track).not.toHaveBeenCalledWith('onboarding_completed');
  state.options?.onNextClick();
  expect(vi.mocked(track).mock.calls).toEqual([['onboarding_start'], ['onboarding_end', { completed: true }], ['onboarding_completed']]);
});

test('early close before highlight still reports once across both destruction hooks', () => {
  startTour('en');
  state.options?.onDestroyStarted(); state.options?.onDestroyed();
  expect(vi.mocked(track).mock.calls).toEqual([['onboarding_start'], ['onboarding_end', { completed: false }], ['onboarding_skipped']]);
});
