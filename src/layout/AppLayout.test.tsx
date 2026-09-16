import { render, screen, within } from '@testing-library/react';
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

// Scoped to the header: these assertions are about what the NAV shows, and the site footer links to
// some of the same places on purpose.
test('primary destinations stay visible, secondary ones hide behind "more"', () => {
  renderLayout();
  const screen2 = within(screen.getByRole('banner'));
  expect(screen2.getByRole('link', { name: /review/i })).toBeInTheDocument();
  expect(screen2.getByRole('link', { name: /library/i })).toBeInTheDocument();
  expect(screen2.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
  expect(screen2.queryByRole('link', { name: /about/i })).not.toBeInTheDocument();
  expect(screen2.queryByRole('link', { name: /support/i })).not.toBeInTheDocument();
  expect(screen2.getByRole('button', { name: /more/i })).toHaveAttribute('aria-expanded', 'false');
});

test('"more" opens the secondary links and Escape closes it', async () => {
  renderLayout();
  const header = within(screen.getByRole('banner'));
  const trigger = header.getByRole('button', { name: /more/i });
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(header.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  expect(header.getByRole('link', { name: /progress/i })).toBeInTheDocument();
  expect(header.getByRole('link', { name: /support/i })).toBeInTheDocument();

  await userEvent.keyboard('{Escape}');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(header.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('a section open from inside "more" still marks the trigger as active', () => {
  renderLayout('/settings');
  expect(within(screen.getByRole('banner')).getByRole('button', { name: /more/i }).className).toContain('text-teal');
});

// The acquirer's moderation reads the site, and a buyer deciding whether to pay should not have to
// hunt through Settings for who is selling and how to reach them.
test('every page carries the seller, the contacts and the legal pages', () => {
  renderLayout();
  const footer = within(screen.getByRole('contentinfo'));
  expect(footer.getByRole('link', { name: /terms|условия/i })).toHaveAttribute('href', '/terms');
  expect(footer.getByRole('link', { name: /privacy|конфиден/i })).toHaveAttribute('href', '/privacy');
  expect(footer.getByText(/Моргунов Александр Сергеевич/)).toBeInTheDocument();
  expect(footer.getByText(/361302397520/)).toBeInTheDocument();
  expect(footer.getByRole('link', { name: /morgunowalex@gmail\.com/ })).toHaveAttribute(
    'href',
    'mailto:morgunowalex@gmail.com'
  );
});
