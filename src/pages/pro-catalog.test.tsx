import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import type * as AccountApi from '@/features/account/api';
import { ProPage } from './ProPage';

const { plans } = vi.hoisted(() => ({ plans: vi.fn() }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true, API_BASE: 'https://qa.invalid' }));
vi.mock('@/features/account/api', async importOriginal => ({ ...await importOriginal<typeof AccountApi>(), billingPlans: plans }));
vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));
const catalog = { available: true, plans: [{ code: 'pro_month', days: 30, priceKopecks: 19900, title: 'Pro' }] };
const open = () => render(<MemoryRouter><ProPage /></MemoryRouter>);
beforeEach(() => { plans.mockReset(); useUiLang.setState({ lang: 'ru' }); });
afterEach(() => { cleanup(); useUiLang.setState({ lang: 'en' }); });

test('loading the catalog does not claim payment is unavailable', () => {
  plans.mockReturnValue(new Promise(() => undefined));
  open();
  expect(screen.getByRole('status')).toHaveTextContent('Проверяем стоимость');
  expect(screen.queryByText(/Оплата скоро появится|Оформление подписки сейчас недоступно/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Перейти к аккаунту и пробному периоду' })).toHaveAttribute('href', '/settings');
});

test('a failed lookup can recover without presenting a server outage as unavailable product', async () => {
  plans.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(catalog);
  open();
  await userEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
  expect(await screen.findByRole('link', { name: 'Подключить Pro в настройках' })).toHaveAttribute('href', '/settings');
  expect(screen.getByText(/199.*30 дней/)).toBeInTheDocument();
  expect(screen.queryByText(/Оплата скоро появится/)).not.toBeInTheDocument();
});

test('a server-disabled checkout still explains the managed free trial', async () => {
  plans.mockResolvedValue({ ...catalog, available: false });
  open();
  expect(await screen.findByText(/Оформление подписки сейчас недоступно/)).toHaveTextContent('пробном периоде');
  expect(screen.queryByRole('link', { name: 'Подключить Pro в настройках' })).not.toBeInTheDocument();
});
