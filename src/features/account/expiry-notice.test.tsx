/**
 * The reminder as the dashboard shows it. The dashboard reads no account data otherwise, so the one
 * thing that must stay true for everybody else is that this renders nothing and asks for nothing.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { ExpiryNotice } from './ExpiryNotice';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import type { Entitlement } from './contract';

const DAY = 86_400_000;
const pro = (paidUntil: number): Entitlement => ({ plan: 'pro', active: true, paidUntil, ai: { used: 0, limit: 10 } });

const show = () => render(<ExpiryNotice ru={false} />, { wrapper: MemoryRouter });
const ENDING = /your pro subscription ends/i;

beforeEach(() => {
  localStorage.clear();
  useAccount.setState({ accountId: 'acc-1' } as never);
  useEntitlement.setState({ entitlement: pro(Date.now() + 2 * DAY) });
});

test('names the date and points at the one place a plan is bought', async () => {
  show();
  expect(await screen.findByText(ENDING)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /renew/i })).toHaveAttribute('href', '/settings');
});

test('says nothing to a subscriber with a month still to run', () => {
  useEntitlement.setState({ entitlement: pro(Date.now() + 20 * DAY) });
  show();
  expect(screen.queryByText(ENDING)).not.toBeInTheDocument();
});

// The dashboard is the app's front page. Everyone who is not an expiring subscriber must see exactly
// what they saw before, and no request may be made on their behalf.
test('says nothing when there is no plan to lose', () => {
  useEntitlement.setState({ entitlement: null });
  show();
  expect(screen.queryByText(ENDING)).not.toBeInTheDocument();
});

test('dismissing it takes it away and keeps it away', async () => {
  const first = show();
  await userEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
  expect(screen.queryByText(ENDING)).not.toBeInTheDocument();

  first.unmount();
  show();
  await vi.waitFor(() => expect(screen.queryByText(ENDING)).not.toBeInTheDocument());
});

// Tied to the period, not to the account: a renewal carries a new date, and the old refusal must not
// travel with it — otherwise one dismissal silences every renewal the account ever has.
test('comes back for the next period', async () => {
  const first = show();
  await userEvent.click(await screen.findByRole('button', { name: /dismiss/i }));
  first.unmount();

  useEntitlement.setState({ entitlement: pro(Date.now() + DAY) });
  show();
  expect(await screen.findByText(ENDING)).toBeInTheDocument();
});
