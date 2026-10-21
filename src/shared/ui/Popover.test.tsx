import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Popover } from './Popover';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test.each([-300, 1000])('a lookup stays inside the viewport when its anchor scrolls to %s', async outside => {
  vi.stubGlobal('innerWidth', 360); vi.stubGlobal('innerHeight', 640);
  vi.stubGlobal('visualViewport', { width: 360, height: 640 });
  let anchor = 150;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 20, right: 70, top: anchor, bottom: anchor + 20, width: 50, height: 20, x: 20, y: anchor, toJSON: () => ({}) }));
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(180);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(120);
  render(<Popover trigger={<button>Word</button>} label="Meaning" showClose><p>Some meaning</p></Popover>);
  await userEvent.click(screen.getByRole('button', { name: 'Word' }));
  act(() => { anchor = outside; fireEvent.scroll(window); });
  const top = Number.parseFloat(screen.getByRole('dialog', { name: 'Meaning' }).style.top);
  expect(top).toBeGreaterThanOrEqual(8);
  expect(top + 120).toBeLessThanOrEqual(632);
});
