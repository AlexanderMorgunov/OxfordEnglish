import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { NavMore } from './NavMore';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mockLayout(left: number, bottom = 110) {
  const anchor = { left, bottom };
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(176);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: anchor.left, y: anchor.bottom - 32, left: anchor.left, right: anchor.left + 68,
    top: anchor.bottom - 32, bottom: anchor.bottom, width: 68, height: 32,
    toJSON: () => ({}),
  }));
  return anchor;
}

function renderDisclosure() {
  render(<MemoryRouter><nav><NavMore label="More" items={[
    { to: '/settings', label: 'Settings', icon: '/assets/pixel/nav/settings.png' },
    { to: '/support', label: 'Support', icon: '/assets/pixel/nav/support.png' },
  ]} /></nav></MemoryRouter>);
  return screen.getByRole('button', { name: 'More' });
}

test.each([
  { left: 20, expected: 20 },
  { left: -20, expected: 8 },
  { left: 760, expected: 616 },
])('the disclosure follows its trigger at $left and stays inside the viewport', async ({ left, expected }) => {
  mockLayout(left);
  const button = renderDisclosure();
  await userEvent.click(button);
  const panel = document.getElementById(button.getAttribute('aria-controls')!);
  expect(panel).not.toBeNull();
  const placedLeft = left + Number.parseFloat(panel!.style.left);
  expect(placedLeft).toBe(expected);
  expect(panel!.style.maxHeight).toBe('478px');
});

test('an open disclosure follows parent reflow and scroll, then disconnects on Escape', async () => {
  const anchor = mockLayout(20);
  let notifyResize = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { notifyResize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const button = renderDisclosure();
  await userEvent.click(button);
  const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
  act(() => { anchor.left = 760; notifyResize(); });
  expect(anchor.left + Number.parseFloat(panel.style.left)).toBe(616);
  act(() => { anchor.bottom = 500; fireEvent.scroll(window); });
  expect(panel.style.maxHeight).toBe('88px');
  act(() => { anchor.left = 60; fireEvent.resize(window); });
  expect(anchor.left + Number.parseFloat(panel.style.left)).toBe(60);
  await userEvent.keyboard('{Escape}');
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveFocus();
  expect(panel).not.toBeInTheDocument();
  expect(disconnect).toHaveBeenCalledOnce();
});

test('height changes account for the scrollbar before clamping the panel width', async () => {
  const anchor = mockLayout(760, 500);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return Number.parseFloat(this.style.maxHeight) > 200 ? 176 : 191;
  });
  const button = renderDisclosure();
  await userEvent.click(button);
  const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
  expect(anchor.left + Number.parseFloat(panel.style.left)).toBe(601);
  act(() => { anchor.bottom = 110; fireEvent.resize(window); });
  expect(anchor.left + Number.parseFloat(panel.style.left)).toBe(616);
});
