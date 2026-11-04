import { useEffect, useState } from 'react';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  createMemoryRouter,
  Link,
  Outlet,
  RouterProvider,
} from 'react-router-dom';
import { RecoveryNavigationGuard } from '@/features/account/RecoveryNavigationGuard';
import { useRecoveryDraft } from '@/features/account/recovery-draft';
import { Dialog } from '@/shared/ui/Dialog';
import { installDialogMock } from '@/test/dialog';
let router: ReturnType<typeof createMemoryRouter>;
beforeEach(() => {
  installDialogMock();
  document.body.style.overflow = '';
  const NativeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, { ...init, signal: undefined });
      }
    }
  );
});
afterEach(() => {
  cleanup();
  router?.dispose();
  vi.unstubAllGlobals();
  document.body.style.overflow = '';
});
function Draft() {
  useRecoveryDraft(true);
  return <Link to="/terms">Host route exit</Link>;
}
function Host() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const reset = () => setOpen(false);
    window.addEventListener('qa-owner-reset', reset);
    return () => window.removeEventListener('qa-owner-reset', reset);
  }, []);
  return open ? (
    <Dialog title="Recovery host" onClose={() => setOpen(false)}>
      <Draft />
    </Dialog>
  ) : null;
}
function Layout() {
  return (
    <RecoveryNavigationGuard>
      <Host />
      <Outlet />
    </RecoveryNavigationGuard>
  );
}
test('owner reset clears both nested guard and scroll lock', async () => {
  router = createMemoryRouter([
    {
      element: <Layout />,
      children: [
        { path: '/', element: <h1>Home</h1> },
        { path: '/terms', element: <h1>Terms</h1> },
      ],
    },
  ]);
  render(<RouterProvider router={router} />);
  await userEvent.click(
    await screen.findByRole('link', { name: 'Host route exit' })
  );
  const guard = await screen.findByRole('dialog', {
    name: 'Save your backup codes',
  });
  expect(
    within(guard).getByRole('button', { name: 'Stay and save' })
  ).toBeVisible();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  act(() => window.dispatchEvent(new Event('qa-owner-reset')));
  await waitFor(() =>
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(0)
  );
  expect(document.body.style.overflow).toBe('');
  expect(router.state.location.pathname).toBe('/');
});
