import 'fake-indexeddb/auto';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import {
  acceptTheme,
  APPEARANCE_KEY,
  useTheme,
} from '@/features/appearance/themes';
import { AppearanceThemes } from '@/features/appearance/ThemePicker';
import { acceptUiTextSize } from '@/features/appearance/store';
import { FirstEntryWelcome } from './FirstEntryWelcome';
import { WELCOME_KEY } from './memory';

vi.mock('@/features/account/AccessFlow', () => ({
  AccessFlow: () => <p>Account flow</p>,
}));
const show = () =>
  render(
    <MemoryRouter>
      <main tabIndex={-1}>Current task</main>
      <FirstEntryWelcome />
    </MemoryRouter>
  );
beforeEach(async () => {
  localStorage.clear();
  acceptTheme('studio', false);
  acceptUiTextSize(1);
  await Promise.all(
    [
      db.attempts,
      db.wordStatus,
      db.srsCards,
      db.checkpoints,
      db.books,
      db.bookmarks,
      db.activity,
      db.reviewLog,
      db.feedbackOutbox,
    ].map((table) => table.clear())
  );
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test('first welcome opens automatically despite old progress and preserves saved appearance', async () => {
  localStorage.setItem('onboarding.seen', '1');
  localStorage.setItem('dayenglish.first-entry.v1', 'seen');
  localStorage.setItem(
    'oxford-appearance',
    JSON.stringify({ theme: 'bloom', dismissed: true })
  );
  acceptTheme('bloom', true);
  await db.attempts.add({
    exerciseId: 'existing',
    tags: [],
    correct: true,
    userAnswer: 'hello',
    attemptNumber: 1,
    timestamp: Date.now(),
    usedHint: false,
    usedAI: false,
  });
  show();
  const dialog = await screen.findByRole('dialog', {
    name: 'English at your own pace.',
  });
  expect(document.documentElement.dataset.theme).toBe('bloom');
  expect(localStorage.getItem(WELCOME_KEY)).toBeNull();
  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  );
  expect(localStorage.getItem(WELCOME_KEY)).toBe('seen');
  cleanup();
  show();
  await waitFor(() =>
    expect(document.querySelector('[data-welcome-pending]')).toBeNull()
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('an interrupted first welcome is shown again after remount until explicitly dismissed', async () => {
  show();
  await screen.findByRole('dialog');
  expect(document.documentElement.dataset.theme).toBe('paper');
  expect(localStorage.getItem(WELCOME_KEY)).toBeNull();
  cleanup();
  show();
  await screen.findByRole('dialog');
  act(() => fireEvent.click(screen.getByRole('button', { name: 'Start now' })));
  expect(localStorage.getItem(WELCOME_KEY)).toBe('seen');
});

const themeSettings = (welcome = true) => (
  <MemoryRouter initialEntries={['/settings/interface']}>
    <main tabIndex={-1}>
      <AppearanceThemes placement="settings" />
    </main>
    {welcome && <FirstEntryWelcome />}
  </MemoryRouter>
);

async function openThemeSettings() {
  localStorage.setItem(WELCOME_KEY, 'seen');
  localStorage.setItem(
    APPEARANCE_KEY,
    JSON.stringify({ theme: 'bloom', dismissed: true })
  );
  acceptTheme('bloom', true);
  const view = render(themeSettings());
  await waitFor(() =>
    expect(document.querySelector('[data-welcome-pending]')).toBeNull()
  );
  return view;
}

test('a closed welcome preserves the swatch choice until Apply saves it', async () => {
  await openThemeSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Try theme Daylight' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(useTheme.getState().theme).toBe('paper');
  expect(document.documentElement.dataset.theme).toBe('paper');
  expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual({
    theme: 'paper',
    dismissed: true,
  });
});

test('a closed welcome leaves another dialog preview intact on pagehide', async () => {
  await openThemeSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Change theme' }));
  fireEvent.click(screen.getByRole('radio', { name: /^Daylight/ }));
  fireEvent(window, new Event('pagehide'));
  expect(useTheme.getState().draft).toBe('paper');
  expect(document.documentElement.dataset.theme).toBe('paper');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(useTheme.getState().theme).toBe('bloom');
  expect(document.documentElement.dataset.theme).toBe('bloom');
});

test('unmounting a closed welcome does not cancel another dialog preview', async () => {
  const view = await openThemeSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Change theme' }));
  fireEvent.click(screen.getByRole('radio', { name: /^Daylight/ }));
  view.rerender(themeSettings(false));
  expect(useTheme.getState().draft).toBe('paper');
  expect(document.documentElement.dataset.theme).toBe('paper');
});

test('unmounting an open welcome still restores its unsaved theme preview', async () => {
  acceptTheme('bloom', true);
  localStorage.setItem(
    APPEARANCE_KEY,
    JSON.stringify({ theme: 'bloom', dismissed: true })
  );
  const view = show();
  await screen.findByRole('dialog');
  act(() => useTheme.getState().preview('paper'));
  expect(document.documentElement.dataset.theme).toBe('paper');
  view.unmount();
  expect(useTheme.getState().draft).toBeNull();
  expect(document.documentElement.dataset.theme).toBe('bloom');
});
