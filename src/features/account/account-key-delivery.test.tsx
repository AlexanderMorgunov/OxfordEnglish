import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Session } from './contract';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', async original => ({ ...await original<object>(),
  devicePoll: vi.fn(), totpStatus: vi.fn(async () => ({ available: true, enrolled: true, backupCodesLeft: 4, pending: false, recoverFailures: 0, recoveryName: false })),
}));
vi.mock('./QuotaNotice', () => ({ QuotaNotice: () => null }));
vi.mock('./PlanSection', () => ({ PlanSection: () => null }));
vi.mock('@/features/reader/blobSync', () => ({ useBookFileSync: (select: (value: { enabled: boolean; setEnabled: () => void }) => unknown) => select({ enabled: false, setEnabled: () => {} }) }));

import * as api from './api';
import { AccountSection } from './AccountSection';
import { TotpEnroll } from './TotpSection';
import { useAccount } from './store';
import { db } from '@/db/db';

const originalRotate = useAccount.getState().rotateRecoveryKey;
const session = (accountId: string): Session => ({ accountId, deviceId: 'synthetic-device', refreshToken: `synthetic-${accountId}`, accessToken: `synthetic-access-${accountId}`, accessExpiresAt: Date.now() + 600_000 });
async function adopt(accountId: string) {
  vi.mocked(api.devicePoll).mockResolvedValue({ status: 'approved', session: session(accountId) });
  await useAccount.getState().pollDeviceLink('synthetic-request');
}

beforeEach(async () => {
  vi.clearAllMocks(); localStorage.clear();
  useAccount.setState({ rotateRecoveryKey: originalRotate, status: 'anonymous', accountId: null, accessToken: null });
  await db.open();
  await adopt('account-A');
});
afterEach(() => { cleanup(); useAccount.setState({ rotateRecoveryKey: originalRotate }); });

async function issue() {
  await userEvent.click(await screen.findByRole('button', { name: 'New recovery key' }));
  fireEvent.change(screen.getByPlaceholderText('6 digits from the app'), { target: { value: '123456' } });
  await userEvent.click(screen.getByRole('button', { name: 'Issue a key' }));
}

test('the TOTP caller refuses a late key even when a mocked service resolves after the account changes', async () => {
  let finish!: (value: string) => void;
  useAccount.setState({ rotateRecoveryKey: () => new Promise(resolve => { finish = resolve; }) });
  const delivered = vi.fn();
  render(<TotpEnroll ru={false} onNewKey={delivered} />);
  await issue();
  await act(async () => { await adopt('account-B'); finish('account-A.synthetic-not-a-credential'); });
  expect(delivered).not.toHaveBeenCalled();
});

test('an already displayed key leaves the account UI on a different or same-account replacement', async () => {
  useAccount.setState({ rotateRecoveryKey: async () => 'account-A.synthetic-not-a-credential' });
  render(<AccountSection />, { wrapper: MemoryRouter });
  await issue();
  await screen.findByRole('checkbox', { name: 'I have saved the key somewhere safe' });
  await act(async () => { await adopt('account-A'); });
  expect(screen.queryByRole('checkbox', { name: 'I have saved the key somewhere safe' })).toBeNull();
  await issue();
  await screen.findByRole('checkbox', { name: 'I have saved the key somewhere safe' });
  await act(async () => { await adopt('account-B'); });
  expect(screen.queryByRole('checkbox', { name: 'I have saved the key somewhere safe' })).toBeNull();
});

test('cross-tab replacement clears the displayed key when its storage event arrives', async () => {
  useAccount.setState({ rotateRecoveryKey: async () => 'account-A.synthetic-not-a-credential' });
  render(<AccountSection />, { wrapper: MemoryRouter });
  await issue();
  await screen.findByRole('checkbox', { name: 'I have saved the key somewhere safe' });
  const previous = JSON.parse(localStorage.getItem('oxford-account')!);
  await act(async () => {
    localStorage.setItem('oxford-account', JSON.stringify({ ...previous, incarnation: 'synthetic-other-tab-incarnation' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'oxford-account' }));
  });
  await waitFor(() => expect(screen.queryByRole('checkbox', { name: 'I have saved the key somewhere safe' })).toBeNull());
});
