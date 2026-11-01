import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReaderWidget } from './ReaderWidget';
import type { ReaderAudioControls } from './ReaderWidget';
import { NAVIGATION_INSETS_EVENT } from '@/shared/lib/navigation-insets';

const renderWidget = () =>
  render(
    <MemoryRouter>
      <ReaderWidget
        onBookmarkHere={() => Promise.resolve({ added: true })}
        bookmarks={[]}
        progress={new Map()}
        onJump={() => undefined}
        onDelete={() => undefined}
      />
    </MemoryRouter>
  );

const openPanel = async () => {
  await userEvent.click(screen.getByRole('button', { name: /quick actions/i }));
};

test('the panel is closed until the trigger is pressed', async () => {
  renderWidget();
  const trigger = screen.getByRole('button', { name: /quick actions/i });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(
    screen.queryByRole('navigation', { name: /sections/i })
  ).not.toBeInTheDocument();
  await openPanel();
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('icon-only section links keep an accessible name and the right target', async () => {
  renderWidget();
  await openPanel();
  // Every destination carries the marker, which is what puts a "back to reading" link on that page.
  const expected: [RegExp, string][] = [
    [/vocabulary/i, '/vocabulary?from=reader'],
    [/today/i, '/?from=reader'],
    [/grammar/i, '/grammar?from=reader'],
    [/review/i, '/review?from=reader'],
    [/library/i, '/library?from=reader'],
  ];
  for (const [name, href] of expected) {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  }
  expect(screen.getAllByRole('link')).toHaveLength(expected.length);
});

test('dock delegates every playback action to the existing reading session and shows real progress', async () => {
  const audio: ReaderAudioControls = {
    available: true,
    active: false,
    engaged: false,
    onToggle: vi.fn(),
    onNext: vi.fn(),
    onStop: vi.fn(),
  };
  const props = {
    onBookmarkHere: async () => ({ added: true }),
    bookmarks: [],
    progress: new Map<string, number>(),
    onJump: () => {},
    onDelete: () => {},
  };
  const { rerender } = render(
    <MemoryRouter>
      <ReaderWidget
        {...props}
        audio={audio}
        bookProgress={0.37}
        chapterLabel="Chapter 2"
      />
    </MemoryRouter>
  );
  expect(
    screen.getByRole('progressbar', { name: 'Book position' })
  ).toHaveAttribute('value', '37');
  expect(screen.getByRole('button', { name: 'Next sentence' })).toBeDisabled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Read chapter aloud' })
  );
  expect(audio.onToggle).toHaveBeenCalledOnce();
  rerender(
    <MemoryRouter>
      <ReaderWidget
        {...props}
        audio={{ ...audio, active: true, engaged: true }}
        bookProgress={0.38}
      />
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Pause reading' }));
  await userEvent.click(screen.getByRole('button', { name: 'Next sentence' }));
  await userEvent.click(screen.getByRole('button', { name: 'Stop reading' }));
  expect(audio.onToggle).toHaveBeenCalledTimes(2);
  expect(audio.onNext).toHaveBeenCalledOnce();
  expect(audio.onStop).toHaveBeenCalledOnce();
});

test('bookmark failure stays an error rather than reporting a saved bookmark', async () => {
  render(
    <MemoryRouter>
      <ReaderWidget
        onBookmarkHere={async () => {
          throw new Error('storage denied');
        }}
        bookmarks={[]}
        progress={new Map()}
        onJump={() => {}}
        onDelete={() => {}}
      />
    </MemoryRouter>
  );
  await openPanel();
  await userEvent.click(screen.getByRole('button', { name: /^Add bookmark$/ }));
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Could not save the bookmark'
  );
  expect(screen.getByRole('button', { name: 'Quick actions' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  expect(screen.queryByText('Bookmarked')).not.toBeInTheDocument();
});

test('outside dismissal and Escape close quick actions and Escape restores the trigger', async () => {
  renderWidget();
  await openPanel();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Quick actions' })).toHaveFocus();
  expect(
    screen.queryByRole('navigation', { name: 'Sections' })
  ).not.toBeInTheDocument();
  await openPanel();
  await userEvent.click(document.body);
  expect(screen.getByRole('button', { name: 'Quick actions' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});

test('dock height changes publish navigation insets once, unchanged measurements do not loop, and unmount restores the inset', () => {
  const root = document.documentElement;
  const previous = root.style.getPropertyValue('--reader-dock-height');
  root.style.removeProperty('--reader-dock-height');
  let height = 72;
  let bottomOffset = 0;
  let resize: (() => void) | undefined;
  const originalBounds = HTMLElement.prototype.getBoundingClientRect;
  const bounds = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('rdc-dock')
        ? {
            ...originalBounds.call(this),
            height,
            top: window.innerHeight - height - bottomOffset,
          }
        : originalBounds.call(this);
    });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe(element: Element) {
        if (element.classList.contains('rdc-dock')) resize = this.callback;
      }
      disconnect() {}
    }
  );
  const event = vi.fn();
  window.addEventListener(NAVIGATION_INSETS_EVENT, event);
  try {
    const view = renderWidget();
    expect(root.style.getPropertyValue('--reader-dock-height')).toBe('72px');
    expect(event).toHaveBeenCalledTimes(1);
    resize?.();
    expect(event).toHaveBeenCalledTimes(1);
    height = 110;
    resize?.();
    expect(event).toHaveBeenCalledTimes(2);
    expect(root.style.getPropertyValue('--reader-dock-height')).toBe('110px');
    height = 80;
    bottomOffset = 20;
    resize?.();
    expect(root.style.getPropertyValue('--reader-dock-height')).toBe('100px');
    expect(event).toHaveBeenCalledTimes(3);
    height = 0;
    resize?.();
    expect(root.style.getPropertyValue('--reader-dock-height')).toBe('0px');
    expect(event).toHaveBeenCalledTimes(4);
    view.unmount();
    expect(event).toHaveBeenCalledTimes(5);
    expect(root.style.getPropertyValue('--reader-dock-height')).toBe('');
  } finally {
    bounds.mockRestore();
    vi.unstubAllGlobals();
    window.removeEventListener(NAVIGATION_INSETS_EVENT, event);
    if (previous) root.style.setProperty('--reader-dock-height', previous);
    else root.style.removeProperty('--reader-dock-height');
  }
});
