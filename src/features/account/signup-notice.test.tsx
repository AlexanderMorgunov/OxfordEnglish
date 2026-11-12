import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
let owned = true;
vi.mock('./store', () => ({
  captureAccountSessionOwner: () => () => owned,
  useAccount: (select: (state: { sessionRevision: number }) => number) =>
    select({ sessionRevision: 0 }),
}));
import { AccountAccessNotice } from './AccountAccessNotice';
import { showAccountAccessNotice, useSignupNotice } from './signupNotice';
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 1, 12));
  owned = true;
  useSignupNotice.getState().close();
});
afterEach(() => {
  vi.useRealTimers();
});
test('confirmation uses the actual expiry and can be dismissed', () => {
  showAccountAccessNotice({
    plan: 'trial',
    active: true,
    trialEndsAt: Date.UTC(2026, 10, 9),
    ai: { used: 0, limit: 1000 },
  });
  render(<AccountAccessNotice />);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Free trial — until 9 November'
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Dismiss Pro confirmation' })
  );
  expect(screen.queryByRole('status')).toBeNull();
});
test('a different tab changing the logical session clears the old confirmation without a local revision change', () => {
  showAccountAccessNotice({
    plan: 'pro',
    active: true,
    paidUntil: Date.UTC(2026, 11, 2),
    ai: { used: 0, limit: 1000 },
  });
  render(<AccountAccessNotice />);
  expect(screen.getByRole('status')).toBeVisible();
  owned = false;
  act(() =>
    window.dispatchEvent(new StorageEvent('storage', { key: 'oxford-account' }))
  );
  expect(screen.queryByRole('status')).toBeNull();
  expect(useSignupNotice.getState().notice).toBeNull();
});
