import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { AppHeader } from './AppHeader';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--app-nav-top');
  document.documentElement.style.removeProperty('--app-nav-bottom');
});
function geometry(initialWidth: number, utilityWidth = 180) {
  let width = initialWidth,
    label = 60;
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', 900);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('app-container')
        ? Math.min(1160, width)
        : 0;
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const w = this.classList.contains('app-brand')
        ? 200
        : this.classList.contains('app-nav-primary')
          ? 600
          : this.classList.contains('app-nav-utilities')
            ? utilityWidth
            : this.classList.contains('app-nav-label-probe')
              ? label
              : 44;
      return new DOMRect(
        0,
        0,
        w,
        this.classList.contains('app-nav-bottom') ? 74 : 86
      );
    }
  );
  return async (next: number, large = false) => {
    await act(async () => {
      width = next;
      label = large ? 120 : 60;
      vi.stubGlobal('innerWidth', width);
      fireEvent.resize(window);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  };
}
const renderHeader = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeader />
    </MemoryRouter>
  );

test('wide navigation exposes one copy of every primary section and keeps Pro and DEV kit in More', async () => {
  geometry(1440);
  renderHeader('/grammar/present-simple');
  const primary = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(primary).getAllByRole('link')).toHaveLength(6);
  expect(screen.getByRole('link', { name: 'Grammar' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(
    screen.getByRole('link', { name: 'DayEnglish Pro' })
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'UI kit' })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Grammar' })).toHaveLength(1);
});

test('compact has five labelled bottom destinations and keeps the current secondary destination visible', async () => {
  geometry(390);
  renderHeader('/settings/interface');
  expect(
    screen.getByRole('navigation', { name: 'Main navigation' })
  ).toHaveClass('app-nav-bottom');
  expect(
    within(
      screen.getByRole('navigation', { name: 'Main navigation' })
    ).getAllByRole('link')
  ).toHaveLength(5);
  const more = screen.getByRole('button', { name: 'More · Settings' });
  expect(more).toHaveTextContent('Settings');
  await userEvent.click(more);
  expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await userEvent.keyboard('{Escape}');
  expect(more).toHaveFocus();
  expect(more).toHaveTextContent('Settings');
});

test('wider help utilities move only Progress into More while keeping desktop primary navigation', async () => {
  geometry(1440, 330);
  renderHeader();
  const primary = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(primary).toHaveClass('app-nav-primary');
  expect(within(primary).getAllByRole('link')).toHaveLength(5);
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('link', { name: 'Progress' })).toBeVisible();
});

test('large labels use a complete Sections disclosure instead of clipping the bottom bar', async () => {
  const resize = geometry(390);
  renderHeader('/library/catalog/alice');
  await resize(390, true);
  expect(
    screen.queryByRole('navigation', { name: 'Main navigation' })
  ).not.toBeInTheDocument();
  const sections = screen.getByRole('button', { name: 'Sections · Library' });
  expect(sections).toHaveAttribute('data-tour', 'nav-sections');
  await userEvent.click(sections);
  expect(
    within(
      screen.getByRole('navigation', { name: 'Main navigation' })
    ).getAllByRole('link')
  ).toHaveLength(5);
  expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

test('resize transfers focused primary and secondary destinations without leaving focus in a removed element', async () => {
  const resize = geometry(1440);
  renderHeader();
  act(() => screen.getByRole('link', { name: 'Settings' }).focus());
  await resize(390);
  const more = screen.getByRole('button', { name: 'More' });
  expect(more).toHaveFocus();
  await userEvent.click(more);
  act(() => screen.getByRole('link', { name: 'Settings' }).focus());
  await resize(1440);
  expect(screen.getByRole('link', { name: 'Settings' })).toHaveFocus();
  act(() => screen.getByRole('link', { name: 'Library' }).focus());
  await resize(390, true);
  expect(screen.getByRole('button', { name: /^Sections/ })).toHaveFocus();
  await resize(1440);
  expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
});

test('Tab exits the disclosure without a focus trap or trigger refocus', async () => {
  geometry(1440);
  render(
    <MemoryRouter>
      <AppHeader />
      <button>After header</button>
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  act(() => screen.getByRole('link', { name: 'UI kit' }).focus());
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'After header' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
});

function Back() {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(-1)}>History back</button>;
}
test('browser history and query-only navigation close an open disclosure', async () => {
  geometry(390);
  render(
    <MemoryRouter
      initialEntries={['/grammar', '/settings/interface']}
      initialIndex={1}
    >
      <AppHeader />
      <Back />
    </MemoryRouter>
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'More · Settings' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'History back' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  );
  expect(screen.getByRole('link', { name: 'Grammar' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});
