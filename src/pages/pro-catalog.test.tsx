import 'fake-indexeddb/auto';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import type * as AccountApi from '@/features/account/api';
import { ProPage } from './ProPage';
import { useProActivation } from '@/features/account/proActivation';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';

const { plans } = vi.hoisted(() => ({ plans: vi.fn() }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true, API_BASE: 'https://qa.invalid' }));
vi.mock('@/features/account/api', async importOriginal => ({ ...await importOriginal<typeof AccountApi>(), billingPlans: plans }));
vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));
const catalog = { available: true, plans: [{ code: 'pro_month', days: 30, priceKopecks: 19900, title: 'Pro' }] };
const open = () => render(<MemoryRouter><ProPage /></MemoryRouter>);
beforeEach(() => {
  plans.mockReset();
  useUiLang.setState({ lang: 'ru' });
  useProActivation.getState().close();
  useAccount.setState({ status: 'anonymous', accountId: null });
  useEntitlement.getState().clear();
});
afterEach(() => { cleanup(); useUiLang.setState({ lang: 'en' }); });

test('loading the catalog does not claim payment is unavailable', () => {
  plans.mockReturnValue(new Promise(() => undefined));
  open();
  expect(screen.getByRole('status')).toHaveTextContent('Проверяем актуальную цену');
  expect(screen.queryByText(/Оплата скоро появится|Оформление подписки сейчас недоступно/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Попробовать 14 дней' })).toBeEnabled();
});

test('a failed lookup can recover without presenting a server outage as unavailable product', async () => {
  plans.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(catalog);
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Повторить загрузку цены' }));
  expect(await screen.findByText(/199.*30 дней/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Попробовать 14 дней' }));
  expect(useProActivation.getState().entry?.task.source).toBe('pro');
  expect(screen.queryByText(/Оплата скоро появится/)).not.toBeInTheDocument();
});

test('a server-disabled checkout still explains the managed free trial', async () => {
  plans.mockResolvedValue({ ...catalog, available: false });
  open();
  expect(await screen.findByText('Оплата пока недоступна.')).toBeVisible();
  expect(screen.getByText('14 дней бесплатно')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Попробовать 14 дней' })).toBeEnabled();
  expect(screen.queryByText(/199.*30 дней/)).toBeNull();
});

test('the Pro card follows trial expiry, purchase and paid expiry without offering another trial', async () => {
  plans.mockResolvedValue(catalog);
  useAccount.setState({ status: 'authenticated', accountId: 'fixture-account' });
  const trial = { plan: 'trial' as const, active: true, trialEndsAt: Date.now() + 86400000, ai: { used: 0, limit: 100 } };
  useEntitlement.setState({ entitlement: trial });
  open();
  expect(await screen.findByRole('button', { name: /Оформить Pro.*199/ })).toBeEnabled();
  expect(screen.getByRole('link', { name: 'Моя подписка ↓' })).toHaveAttribute('href', '#pro-access');
  act(() => useEntitlement.setState({ entitlement: { ...trial, trialEndsAt: Date.now() - 1 } }));
  expect(screen.getByRole('heading', { name: /Пробный период закончился/ })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Оформить Pro ↓' })).toHaveAttribute('href', '#pro-access');
  expect(screen.getByRole('button', { name: /Оформить Pro.*199/ })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Попробовать 14 дней/ })).toBeNull();
  const paid = { ...trial, plan: 'pro' as const, paidUntil: Date.now() + 86400000 };
  act(() => useEntitlement.setState({ entitlement: paid }));
  expect(screen.getByRole('link', { name: 'Моя подписка ↓' })).toBeVisible();
  expect(screen.getByRole('button', { name: /Продлить.*199/ })).toBeEnabled();
  act(() => useEntitlement.setState({ entitlement: { ...paid, paidUntil: Date.now() - 1 } }));
  expect(screen.getByRole('heading', { name: /Подписка закончилась/ })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Продлить Pro ↓' })).toHaveAttribute('href', '#pro-access');
  expect(screen.getByRole('button', { name: /Продлить.*199/ })).toBeEnabled();
  expect(screen.queryByText(/Пробный период закончился/)).toBeNull();
});
