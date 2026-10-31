import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, test, vi } from 'vitest';
import { AppHeader } from './AppHeader';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function layout(initialWidth: number) {
  let width = initialWidth;
  const originalStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const style = originalStyle(element);
    if (element.classList.contains('app-container')) {
      return Object.assign(style, { paddingLeft: '20px', paddingRight: '20px', columnGap: '16px' });
    }
    return Object.assign(style, { columnGap: '4px' });
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('app-container') ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.parentElement?.classList.contains('app-container') ? 150
      : this.parentElement?.parentElement?.hasAttribute('inert') ? this === this.parentElement.lastElementChild ? 80 : 100
        : 80;
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: 36, width: w, height: 36, toJSON: () => ({}) };
  });
  return (next: number) => act(() => { width = next; fireEvent.resize(window); });
}

const renderHeader = (path = '/') => render(<MemoryRouter initialEntries={[path]}><AppHeader /></MemoryRouter>);

test('promotes only the links that fit, while Pro and the development kit stay in More', async () => {
  const resize = layout(1120);
  renderHeader('/settings');
  expect(screen.getByRole('link', { name: 'settings' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: 'more' })).not.toHaveClass('text-teal');
  await userEvent.click(screen.getByRole('button', { name: 'more' }));
  expect(screen.getByRole('link', { name: 'Pro' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'kit' })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'settings' })).toHaveLength(1);
  await userEvent.keyboard('{Escape}');

  resize(950);
  expect(screen.getByRole('link', { name: 'progress' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'settings' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'more' })).toHaveClass('text-teal');
  resize(375);
  expect(screen.queryByRole('link', { name: 'progress' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('navigation')).getAllByRole('link')).toHaveLength(5);
});

test('keeps keyboard focus reachable when a focused destination moves into or out of More', async () => {
  const resize = layout(1120);
  renderHeader();
  act(() => screen.getByRole('link', { name: 'settings' }).focus());
  resize(375);
  const more = screen.getByRole('button', { name: 'more' });
  expect(more).toHaveFocus();
  await userEvent.click(more);
  act(() => screen.getByRole('link', { name: 'settings' }).focus());
  resize(1120);
  expect(screen.getByRole('link', { name: 'settings' })).toHaveFocus();
  expect(screen.getAllByRole('link', { name: 'settings' })).toHaveLength(1);
});

test('tabbing out closes More without moving focus back to the trigger', async () => {
  layout(375);
  render(<MemoryRouter><AppHeader /><button>After header</button></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'more' }));
  act(() => screen.getByRole('link', { name: 'kit' }).focus());
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'After header' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'more' })).toHaveAttribute('aria-expanded', 'false');
});
