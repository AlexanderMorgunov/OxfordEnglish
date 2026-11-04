import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('./activity', () => ({
  flushPending: vi.fn(),
  recordActivity: vi.fn(),
  setCurrentReading: vi.fn(),
  stashPending: vi.fn(),
}));
vi.mock('@/shared/lib/audio', () => ({ isSpeaking: () => true }));
import { stashPending } from './activity';
import { useReadingTracker } from './useReadingTracker';
import {
  readingSuspended,
  suspendReading,
} from '@/shared/lib/reading-suspension';
let intersections: IntersectionObserverCallback;
let observer: IntersectionObserver;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.stubGlobal(
    'IntersectionObserver',
    class implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [0];
      constructor(callback: IntersectionObserverCallback) {
        intersections = callback;
        observer = {
          root: null,
          rootMargin: '',
          thresholds: [0],
          observe() {},
          disconnect() {},
          unobserve() {},
          takeRecords() {
            return [];
          },
        };
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
  );
  document.body.innerHTML = '<p data-para="0">One two three</p>';
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
test('tour time and words are excluded even while TTS is speaking, without catching up after resume', () => {
  const position = vi.fn();
  const hook = renderHook(() =>
    useReadingTracker({
      bookKey: 'qa-book',
      title: 'Synthetic book',
      pageKey: 'chapter-1',
      paragraphs: ['One two three'],
      onPosition: position,
    })
  );
  act(() =>
    intersections(
      [
        {
          target: document.querySelector('p')!,
          isIntersecting: true,
          intersectionRatio: 1,
          rootBounds: null,
          boundingClientRect: new DOMRect(),
          intersectionRect: new DOMRect(),
          time: performance.now(),
        },
      ],
      observer
    )
  );
  act(() => vi.advanceTimersByTime(2000));
  expect(position).toHaveBeenCalledOnce();
  const resume = suspendReading();
  try {
    act(() => vi.advanceTimersByTime(60000));
    expect(position).toHaveBeenCalledOnce();
  } finally {
    resume();
  }
  act(() => vi.advanceTimersByTime(1000));
  hook.unmount();
  expect(stashPending).toHaveBeenCalledWith(
    expect.objectContaining({ sec: 3, words: 3 })
  );
});
test('overlapping suspension owners and repeated cleanup cannot resume too early', () => {
  const a = suspendReading(),
    b = suspendReading();
  a();
  a();
  expect(readingSuspended()).toBe(true);
  b();
  expect(readingSuspended()).toBe(false);
});
