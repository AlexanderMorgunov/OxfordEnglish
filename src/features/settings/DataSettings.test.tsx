import 'fake-indexeddb/auto';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DataSettings } from './DataSettings';
import { importData } from '@/features/progress/backup';
import { invalidateDataScope } from '@/features/account/dataScope';

vi.mock('@/features/progress/backup', () => ({
  exportData: vi.fn(),
  importData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/migration/snapshot', () => ({ applySnapshot: vi.fn() }));
vi.mock('@/features/account/AccountSection', () => ({
  BookFileSyncToggle: () => null,
  SyncStatusLine: () => null,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function choose(text: () => Promise<string>) {
  const view = render(
    <MemoryRouter>
      <DataSettings accountHref="/settings/account" active />
    </MemoryRouter>
  );
  const file = new File(['{}'], 'backup.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: text });
  fireEvent.change(view.container.querySelector('input[type=file]')!, {
    target: { files: [file] },
  });
  return view;
}
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

test('choosing then cancelling a backup never starts import', () => {
  const read = vi.fn().mockResolvedValue('{"version":4,"attempts":[]}');
  choose(read);
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })
  );
  expect(read).not.toHaveBeenCalled();
  expect(importData).not.toHaveBeenCalled();
});

test('a late file read after account handover cannot import into the next account', async () => {
  let finish!: (text: string) => void;
  choose(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Import' })
  );
  act(() => invalidateDataScope());
  await act(async () => finish('{"version":4,"attempts":[]}'));
  expect(importData).not.toHaveBeenCalled();
});

test('an unrelated JSON file reports failure and can be selected again', async () => {
  const view = choose(async () => '{"unrelated":true}');
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Import' })
  );
  await waitFor(() =>
    expect(screen.getByText(/Import did not finish/)).toBeInTheDocument()
  );
  expect(importData).not.toHaveBeenCalled();
  expect(view.container.querySelector('input[type=file]')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled();
});
