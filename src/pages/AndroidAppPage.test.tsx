import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { AndroidAppPage } from './AndroidAppPage';
import { RUSTORE_URL } from '@/features/android-install/memory';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const show = () =>
  render(
    <MemoryRouter>
      <AndroidAppPage />
    </MemoryRouter>
  );

test('clipboard denial offers a selected exact URL and permits retry', async () => {
  const writeText = vi
    .fn()
    .mockRejectedValueOnce(new Error('Denied'))
    .mockResolvedValueOnce(undefined);
  vi.stubGlobal('navigator', {
    userAgent: 'Windows',
    clipboard: { writeText },
  });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  const input = await screen.findByRole('textbox');
  expect(input).toHaveValue(RUSTORE_URL);
  expect(input).toHaveAttribute('readonly');
  await waitFor(() => expect(input).toHaveFocus());
  expect((input as HTMLInputElement).selectionEnd).toBe(RUSTORE_URL.length);
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  expect(
    await screen.findByText('Link copied. Open it on an Android phone.')
  ).toBeVisible();
  expect(writeText).toHaveBeenLastCalledWith(RUSTORE_URL);
});

test('late clipboard completion after pagehide cannot finish a new attempt', async () => {
  let finishOld!: () => void, finishNew!: () => void;
  const writeText = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          finishOld = done;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          finishNew = done;
        })
    );
  vi.stubGlobal('navigator', {
    userAgent: 'Windows',
    clipboard: { writeText },
  });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  fireEvent(window, new Event('pagehide'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
  await act(async () => finishOld());
  expect(screen.getByRole('button', { name: 'Copy link' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Copying link');
  await act(async () => finishNew());
  expect(screen.getByRole('status')).toHaveTextContent('Link copied');
});

test('native page has no download or copy action and preserves information', () => {
  vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
  show();
  expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  expect(
    screen.queryByRole('link', { name: /Download from RuStore/ })
  ).toBeNull();
  expect(screen.getByText(/already in the Android app/)).toBeVisible();
  expect(screen.getByText(/does not automatically transfer/)).toBeVisible();
});
