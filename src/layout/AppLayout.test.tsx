import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from './AppLayout';

/** AppLayout renders <ScrollRestoration>, which only works inside a data router. */
const renderLayout = (path = '/') => {
  const router = createMemoryRouter(
    [{ element: <AppLayout />, children: [{ path: '/', element: <p>home</p> }, { path: '/settings', element: <p>settings</p> }] }],
    { initialEntries: [path] }
  );
  return render(<RouterProvider router={router} />);
};

test('primary destinations stay visible, secondary ones hide behind "more"', () => {
  renderLayout();
  expect(screen.getByRole('link', { name: /review/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /library/i })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /about/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /more/i })).toHaveAttribute('aria-expanded', 'false');
});

test('"more" opens the secondary links and Escape closes it', async () => {
  renderLayout();
  const trigger = screen.getByRole('button', { name: /more/i });
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /progress/i })).toBeInTheDocument();

  await userEvent.keyboard('{Escape}');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('a section open from inside "more" still marks the trigger as active', () => {
  renderLayout('/settings');
  expect(screen.getByRole('button', { name: /more/i }).className).toContain('text-teal');
});
