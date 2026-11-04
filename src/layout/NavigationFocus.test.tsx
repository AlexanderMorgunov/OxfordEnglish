import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { NavigationFocus } from './NavigationFocus';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 60, 44, 44)
  );
  document.documentElement.style.setProperty('--reader-header-height', '118px');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--reader-header-height');
});

test.each(['rd-reader-header', 'rdc-dock'])(
  'restoring focus inside %s keeps the reading position',
  (className) => {
    render(
      <>
        <NavigationFocus />
        <main className="app-main">
          <div className="rd-book-view">
            <div className={className}>
              <button>Help</button>
            </div>
          </div>
        </main>
      </>
    );
    act(() => {
      screen.getByRole('button').focus({ preventScroll: true });
      vi.advanceTimersByTime(32);
    });
    expect(window.scrollBy).not.toHaveBeenCalled();
  }
);

test('content focus covered by the reader header is still revealed', () => {
  render(
    <>
      <NavigationFocus />
      <main className="app-main">
        <div className="rd-book-view">
          <button>Word</button>
        </div>
      </main>
    </>
  );
  act(() => {
    screen.getByRole('button').focus();
    vi.advanceTimersByTime(32);
  });
  expect(window.scrollBy).toHaveBeenCalledWith({
    top: -70,
    behavior: 'instant',
  });
});
