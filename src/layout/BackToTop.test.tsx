import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BackToTop } from './BackToTop';

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function page(pathname = '/settings') {
  const main = document.createElement('main');
  main.tabIndex = -1;
  document.body.appendChild(main);
  return render(<BackToTop pathname={pathname} mainRef={{ current: main }} />, { container: main });
}
function scroll(y: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
  fireEvent.scroll(window);
}

test('appears after two viewports and stays stable until one viewport from the top', async () => {
  page();
  expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
  scroll(1601);
  expect(await screen.findByRole('button', { name: 'Back to top' })).toBeInTheDocument();
  scroll(1600);
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(screen.getByRole('button', { name: 'Back to top' })).toBeInTheDocument();
  scroll(800);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument());
});

test.each(['/library/book', '/library/catalog/alice', '/review', '/checkpoint/u1', '/billing/success', '/unknown'])('never appears on %s', async (route) => {
  scroll(2400);
  page(route);
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
});

test.each(['/library', '/grammar/article', '/course/u1/day/d1'])('samples an already restored scroll on %s', async (route) => {
  scroll(2400);
  page(route);
  expect(await screen.findByRole('button', { name: 'Back to top' })).toBeInTheDocument();
});

test('keyboard activation focuses main and respects reduced motion', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  scroll(2400);
  const view = page();
  const button = await screen.findByRole('button', { name: 'Back to top' });
  const focus = vi.spyOn(view.container, 'focus');
  act(() => button.focus());
  await userEvent.keyboard('{Enter}');
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(view.container).toHaveFocus();
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
});

test('hides for editable focus and open dialogs, then returns', async () => {
  scroll(2400);
  const view = page();
  await screen.findByRole('button', { name: 'Back to top' });
  const input = document.createElement('input');
  view.container.appendChild(input);
  act(() => input.focus());
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument());
  act(() => input.blur());
  await screen.findByRole('button', { name: 'Back to top' });
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  view.container.appendChild(dialog);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument());
  dialog.removeAttribute('open');
  await screen.findByRole('button', { name: 'Back to top' });
});

test('yields its fixed corner to a pinned interactive control', async () => {
  scroll(2400);
  const view = page();
  const link = document.createElement('a');
  link.href = '#example';
  link.style.position = 'fixed';
  view.container.appendChild(link);
  const rects = vi.spyOn(link, 'getClientRects').mockReturnValue([new DOMRect(-10, -130, 30, 180)] as unknown as DOMRectList);
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  expect(rects).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
  rects.mockReturnValue([] as unknown as DOMRectList);
  link.textContent = 'Layout changed';
  scroll(2500);
  await screen.findByRole('button', { name: 'Back to top' });
});

test('a hidden dialog does not block the control; a visible alertdialog does', async () => {
  scroll(2400);
  const view = page();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-hidden', 'true');
  view.container.appendChild(dialog);
  await screen.findByRole('button', { name: 'Back to top' });
  dialog.removeAttribute('aria-hidden');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument());
  dialog.style.display = 'none';
  await screen.findByRole('button', { name: 'Back to top' });
});

test.each(['static', 'sticky'])('passing %s text does not hide or relocate the control', async (position) => {
  scroll(2400);
  const original = document.createRange.bind(document);
  let occupied = true;
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = original();
    Object.defineProperty(range, 'getClientRects', { value: () => occupied ? [new DOMRect(-10, -130, 30, 180)] : [] });
    return range;
  });
  const view = page();
  const prose = document.createElement('p');
  prose.style.position = position;
  prose.textContent = 'A paragraph reaching the corner.';
  view.container.appendChild(prose);
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  const button = await screen.findByRole('button', { name: 'Back to top' });
  scroll(2800);
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  expect(screen.getByRole('button', { name: 'Back to top' })).toBe(button);
  occupied = false;
  prose.textContent = 'A shorter paragraph after layout changed.';
  await screen.findByRole('button', { name: 'Back to top' });
});

test('flow actions hide the arrow, return its focus and delay recovery until scrolling settles', async () => {
  scroll(2400);
  const view = page();
  const button = await screen.findByRole('button', { name: 'Back to top' });
  act(() => button.focus());
  let occupied = true;
  const link = document.createElement('a'); link.href = '#delete'; link.textContent = 'Delete';
  vi.spyOn(link, 'getClientRects').mockImplementation(() => occupied ? [new DOMRect(-10, -130, 30, 180)] as unknown as DOMRectList : [] as unknown as DOMRectList);
  view.container.appendChild(link);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument());
  expect(view.container).toHaveFocus();
  occupied = false; scroll(2500);
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
  scroll(2600);
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
  await screen.findByRole('button', { name: 'Back to top' });
});

test('a changed action label rechecks the occupied corner without a scroll event', async () => {
  scroll(2400); const view = page();
  let occupied = false;
  const link = document.createElement('a'); link.href = '#action'; link.textContent = 'Short';
  vi.spyOn(link, 'getClientRects').mockImplementation(() => occupied ? [new DOMRect(-10, -130, 30, 180)] as unknown as DOMRectList : [] as unknown as DOMRectList);
  view.container.appendChild(link);
  await screen.findByRole('button', { name: 'Back to top' });
  occupied = true; link.firstChild!.nodeValue = 'A much longer action';
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument());
  occupied = false; link.firstChild!.nodeValue = 'Short';
  await screen.findByRole('button', { name: 'Back to top' });
});

test('viewport changes and threshold oscillation do not repeatedly hide the control', async () => {
  scroll(1610); page();
  const button = await screen.findByRole('button', { name: 'Back to top' });
  for (const y of [1590, 1620, 1580, 1640]) {
    scroll(y);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 820 });
    fireEvent.resize(window);
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(screen.getByRole('button', { name: 'Back to top' })).toBe(button);
  }
});

test.each(['fixed', 'sticky'])('keeps yielding to a %s control after scrolling', async (position) => {
  scroll(2400);
  const view = page();
  const wrapper = document.createElement('div');
  wrapper.style.position = position;
  const link = document.createElement('a');
  link.href = '#pinned';
  wrapper.appendChild(link);
  view.container.appendChild(wrapper);
  vi.spyOn(link, 'getClientRects').mockReturnValue([new DOMRect(-10, -130, 30, 180)] as unknown as DOMRectList);
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  scroll(2800);
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument();
});

test('a dialog inside a CSS-hidden ancestor does not block the control', async () => {
  scroll(2400);
  const view = page();
  const wrapper = document.createElement('div');
  wrapper.style.display = 'none';
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  wrapper.appendChild(dialog);
  view.container.appendChild(wrapper);
  await screen.findByRole('button', { name: 'Back to top' });
  wrapper.style.display = 'block';
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Back to top' })).not.toBeInTheDocument());
});
