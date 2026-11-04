import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as api from './api';
import * as billing from './billing';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import { PurchaseActions } from './PurchaseActions';
import type { BillingPlans } from './contract';

vi.mock('./config', () => ({
  API_BASE: 'https://api.test',
  accountsEnabled: () => true,
}));
vi.mock('./api', async (original) => ({
  ...(await original<object>()),
  billingPlans: vi.fn(),
}));
vi.mock('./billing', async (original) => ({
  ...(await original<object>()),
  beginCheckout: vi.fn(),
  claimPurchase: vi.fn(),
}));
const normal: BillingPlans = {
  available: true,
  campaign: null,
  plans: [
    {
      code: 'pro_month',
      days: 30,
      priceKopecks: 19900,
      regularPriceKopecks: 19900,
      title: 'Month',
    },
    {
      code: 'pro_quarter',
      days: 90,
      priceKopecks: 49900,
      regularPriceKopecks: 49900,
      title: 'Quarter',
    },
    {
      code: 'pro_year',
      days: 365,
      priceKopecks: 149900,
      regularPriceKopecks: 149900,
      title: 'Year',
    },
  ],
};
const sale: BillingPlans = {
  ...normal,
  campaign: {
    id: 'fixture-sale',
    title: 'Pro sale',
    endsAt: Date.now() + 86400000,
  },
  plans: normal.plans.map((p, i) => ({
    ...p,
    priceKopecks: [15000, 39900, 99000][i]!,
  })),
};
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useAccount.setState({
    status: 'authenticated',
    accountId: 'fixture-sale-account',
  });
  useEntitlement.setState({
    entitlement: {
      plan: 'free',
      active: false,
      trialEndsAt: Date.now() - 1,
      ai: { used: 0, limit: 0 },
    },
  });
  vi.mocked(api.billingPlans).mockResolvedValue(sale);
});
afterEach(() => vi.restoreAllMocks());
const setup = () => {
  render(<PurchaseActions />, { wrapper: MemoryRouter });
  return userEvent.setup();
};
test('all three periods remain purchasable at standard prices after the sale', async () => {
  vi.mocked(api.billingPlans).mockResolvedValue(normal);
  setup();
  expect(await screen.findAllByRole('radio')).toHaveLength(3);
  expect(
    screen.getByRole('button', { name: 'Continue to payment · 1499 ₽' })
  ).toBeEnabled();
  expect(screen.queryByText(/After the sale/)).toBeNull();
});
test('a rejected stale quote refreshes prices and requires another explicit decision', async () => {
  const user = setup();
  await screen.findAllByRole('radio');
  await user.click(screen.getByRole('radio', { name: /3 months/ }));
  vi.mocked(api.billingPlans).mockResolvedValue(normal);
  vi.mocked(billing.beginCheckout).mockRejectedValue(
    new api.ApiFailure('billing_price_changed', 409)
  );
  await user.click(
    screen.getByRole('button', { name: 'Continue to payment · 399 ₽' })
  );
  await screen.findByRole('button', { name: 'Confirm new price · 499 ₽' });
  expect(billing.beginCheckout).toHaveBeenCalledExactlyOnceWith(
    'pro_quarter',
    39900
  );
  expect(screen.getByText(/The price changed/)).toBeVisible();
});
test('pending invoice blocks a second order and keeps payment recovery available', async () => {
  localStorage.setItem(
    'dayenglish.billing.pending',
    JSON.stringify({
      accountId: 'fixture-sale-account',
      grantToken: 'fixture-grant-token',
      invoiceId: '123',
      plan: 'pro_year',
      amountKopecks: 99000,
      startedAt: Date.now(),
      paidUntilAtStart: null,
    })
  );
  const user = setup();
  await screen.findByText('Payment is not confirmed yet');
  expect(screen.queryByRole('radio')).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Continue to payment/ })
  ).toBeNull();
  vi.mocked(billing.claimPurchase).mockResolvedValue('pending');
  await user.click(screen.getByRole('button', { name: 'Check payment' }));
  await waitFor(() => expect(billing.claimPurchase).toHaveBeenCalledOnce());
  expect(billing.beginCheckout).not.toHaveBeenCalled();
});
test('unknown entitlement allows recovery but does not offer a new purchase', async () => {
  useEntitlement.setState({ entitlement: null });
  setup();
  await screen.findAllByRole('radio');
  expect(screen.getByRole('button', { name: 'I already paid' })).toBeEnabled();
  expect(
    screen.queryByRole('button', { name: /Continue to payment/ })
  ).toBeNull();
});

test('reader context storage failure keeps the invoice and guards both initial checkout and order retry', async () => {
  const prepare = vi.fn(() => false);
  vi.mocked(billing.beginCheckout).mockImplementation(async () => {
    localStorage.setItem('dayenglish.billing.pending', JSON.stringify({
      accountId: 'fixture-sale-account', grantToken: 'fixture-only-grant', invoiceId: 'reader-order',
      plan: 'pro_month', amountKopecks: 15000, startedAt: Date.now(), paidUntilAtStart: null,
      paymentUrl: 'https://auth.robokassa.ru/Merchant/Index.aspx?fixture=reader',
    }));
    return 'https://auth.robokassa.ru/Merchant/Index.aspx?fixture=reader';
  });
  render(<PurchaseActions initialPlan="pro_month" beforeCheckout={prepare} />, { wrapper: MemoryRouter });
  await userEvent.click(await screen.findByRole('button', { name: 'Continue to payment · 150 ₽' }));
  expect(await screen.findByText(/Could not save the selected word/)).toBeVisible();
  expect(prepare).toHaveBeenCalledOnce();
  expect(localStorage.getItem('dayenglish.billing.pending')).toContain('reader-order');
  await userEvent.click(screen.getByRole('button', { name: 'Return to order checkout' }));
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(billing.beginCheckout).toHaveBeenCalledOnce();
});
