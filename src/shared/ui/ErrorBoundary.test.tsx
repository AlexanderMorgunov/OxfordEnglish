import { Suspense, useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { lazyPage } from '@/shared/lib/lazy-page';
import { pageDiagnostics } from '@/shared/lib/page-diagnostics';
import { restartApp } from '@/shared/lib/page-recovery';

vi.mock('@/shared/lib/page-recovery', () => ({ restartApp: vi.fn() }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(restartApp).mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  localStorage.removeItem('oxford-page-diagnostics');
});

test('one-time effect error recovers only on user retry and focuses main', async () => {
  let crashed = false;
  const paidRequest = vi.fn();
  function Page() {
    useEffect(() => {
      if (!crashed) { crashed = true; throw new TypeError('secret'); }
    }, []);
    return <button onClick={paidRequest}>Translate</button>;
  }
  render(<main tabIndex={-1}><ErrorBoundary resetKey="/library/private"><Page /></ErrorBoundary></main>);
  expect(screen.getByRole('heading', { name: 'Could not open this page' })).toHaveFocus();
  expect(paidRequest).not.toHaveBeenCalled();
  expect(restartApp).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(screen.getByRole('button', { name: 'Translate' })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveFocus();
  expect(paidRequest).not.toHaveBeenCalled();
  expect(pageDiagnostics()[0]).toMatchObject({ route: '/library/:bookId', name: 'TypeError' });
});

test('failed lazy loader offers explicit restart, not a fake module retry or automatic paid call', async () => {
  const paidRequest = vi.fn();
  const loader = vi.fn().mockRejectedValueOnce(new TypeError('secret asset')).mockResolvedValue({ default: () => <button onClick={paidRequest}>Translate</button> });
  const Page = lazyPage(loader);
  const tree = (path: string, show = true) => <ErrorBoundary resetKey={path}><Suspense fallback="Loading">{show ? <Page /> : <p>Dashboard</p>}</Suspense></ErrorBoundary>;
  const view = render(tree('/library'));
  await screen.findByRole('button', { name: 'Restart app' });
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  expect(restartApp).not.toHaveBeenCalled();
  view.rerender(tree('/', false));
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
  view.rerender(tree('/library'));
  await screen.findByRole('button', { name: 'Restart app' });
  expect(loader).toHaveBeenCalledTimes(1);
  expect(paidRequest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Restart app' }));
  expect(restartApp).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Restart app' })).toBeDisabled();
  expect(paidRequest).not.toHaveBeenCalled();
  expect(pageDiagnostics().at(-1)).toMatchObject({ kind: 'page_load', name: 'TypeError' });
});

test('diagnostic details stay selectable when persistent storage fails', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  function Page(): never { throw new Error('private content'); }
  render(<ErrorBoundary resetKey="/library/secret"><Page /></ErrorBoundary>);
  await userEvent.click(screen.getByText('Error details'));
  const details = screen.getByRole('textbox', { name: 'Error diagnostics' });
  expect(details).toHaveAttribute('readonly');
  expect((details as HTMLTextAreaElement).value).toContain('/library/:bookId');
  expect((details as HTMLTextAreaElement).value).not.toMatch(/private|secret/);
  expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/');
});

test.each([false, 0, ''])('falsy thrown value still yields a usable fallback (%j)', async error => {
  function Page(): never { throw error; }
  render(<ErrorBoundary><Page /></ErrorBoundary>);
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Could not open this page' })).toBeInTheDocument());
});
