/**
 * "Я уже оплатил(а)" — the rescue button, at the states where it used to be missing.
 *
 * It rendered only on `plan !== 'pro' && canBuy`. Renewing makes the plan Pro by definition, so the
 * button hid itself in exactly the scenario the owner hit on 22.09: paid, grant left unredeemed, and no
 * control anywhere that could redeem it. `canBuy` took it away a second time whenever the price list
 * failed to load — while the offer goes on promising it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Entitlement } from './contract';
import type * as BillingModule from './billing';
import type * as AccountApi from './api';

const claimPurchase = vi.fn();
const billingPlans = vi.fn();

vi.mock('./billing', async (orig) => ({ ...(await orig<typeof BillingModule>()), claimPurchase, beginCheckout: vi.fn() }));
vi.mock('./api', async (orig) => ({ ...(await orig<typeof AccountApi>()), billingPlans }));

const { useEntitlement } = await import('./entitlement');
const { PlanSection } = await import('./PlanSection');

const OCT = new Date('2026-10-22T09:00:00Z').getTime();
const NOV = new Date('2026-11-21T09:00:00Z').getTime();
const pro = (paidUntil: number): Entitlement => ({ plan: 'pro', active: true, paidUntil, ai: { used: 0, limit: 10 } });

const CLAIM = /i already paid/i;

beforeEach(() => {
  localStorage.clear();
  claimPurchase.mockReset();
  billingPlans.mockReset().mockResolvedValue({ available: true, plans: [{ code: 'pro_month', priceKopecks: 19900 }] });
  useEntitlement.setState({ entitlement: pro(OCT) });
});

test('the button is there while Pro is active', async () => {
  render(<PlanSection ru={false} />, { wrapper: MemoryRouter });
  expect(await screen.findByRole('button', { name: CLAIM })).toBeInTheDocument();
});

test('the button survives a billing endpoint that will not answer', async () => {
  billingPlans.mockRejectedValue(new Error('down'));
  render(<PlanSection ru={false} />, { wrapper: MemoryRouter });
  expect(await screen.findByRole('button', { name: CLAIM })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /extend/i })).not.toBeInTheDocument();
});

// The note is about what the press just achieved, so it has to read the entitlement the claim left
// behind. Built from the one captured in render, it would quote the date the payment replaced — and
// describing the old state as the new one is precisely how the return page's heading and body drifted.
test('a claimed renewal is reported with the new date, not the one it replaced', async () => {
  claimPurchase.mockImplementation(async () => {
    useEntitlement.setState({ entitlement: pro(NOV) });
    return 'granted';
  });
  render(<PlanSection ru={false} />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: CLAIM }));

  expect(await screen.findByText(/now runs until 21 November/i)).toBeInTheDocument();
  expect(screen.queryByText(/22 October/i)).not.toBeInTheDocument();
});

test('a subscriber owed nothing is told so as reassurance', async () => {
  claimPurchase.mockResolvedValue('none');
  render(<PlanSection ru={false} />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: CLAIM }));

  expect(await screen.findByText(/every payment is accounted for/i)).toBeInTheDocument();
});
