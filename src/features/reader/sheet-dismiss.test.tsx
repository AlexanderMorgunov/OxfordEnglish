import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReaderHelp, ReaderHelpEnvironment } from './ReaderHelp';
import { installDialogMock } from '@/test/dialog';

beforeEach(() => {
  window.getSelection()?.removeAllRanges();
  localStorage.removeItem('reader.swipe-dismiss-hint.v1');
  installDialogMock();
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query.includes('coarse'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function show(label = 'Meaning') {
  const dismissed = vi.fn();
  render(<><aside id="swipe-target" /><ReaderHelpEnvironment targetId="swipe-target"><ReaderHelp targetId="swipe-target" label={label} trigger={<button>word</button>} onDismiss={dismissed}>
    <p>Long translation</p><div data-testid="nested" style={{ overflowY: 'auto' }}>Long quote</div><label>Meaning<input /></label><button>Translate</button>
  </ReaderHelp></ReaderHelpEnvironment></>);
  fireEvent.click(screen.getByRole('button', { name: 'word' }));
  const panel = screen.getByRole('dialog', { name: label });
  return { dismissed, panel, body: panel.querySelector<HTMLElement>('.rdh-body')!, header: panel.querySelector<HTMLElement>('.rdh-topline')!, trigger: screen.getByRole('button', { name: 'word' }) };
}
function touch(target: HTMLElement, type: string, x: number, y: number, count = 1, cancelable = true) {
  const point = { identifier: 1, target, clientX: x, clientY: y };
  const event = new Event(type, { bubbles: true, cancelable });
  Object.defineProperties(event, { touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : Array.from({ length: count }, (_, i) => ({ ...point, identifier: i + 1 })) }, changedTouches: { value: [point] } });
  act(() => { target.dispatchEvent(event); });
  return event;
}
function drag(target: HTMLElement, dy = 160, dx = 0) {
  touch(target, 'touchstart', 100, 100);
  const move = touch(target, 'touchmove', 100 + dx, 100 + dy);
  touch(target, 'touchend', 100 + dx, 100 + dy);
  return move;
}

test.each(['Word meaning', 'Phrase meaning', 'Sentence help'])('%s closes on a deliberate downward pull and restores focus', label => {
  const { body, dismissed, trigger } = show(label);
  expect(drag(body).defaultPrevented).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull(); expect(dismissed).toHaveBeenCalledOnce(); expect(trigger).toHaveFocus();
});
test('a gesture beginning scrolled remains native even after it reaches top', () => {
  const { body, panel, dismissed } = show(); body.scrollTop = 100;
  touch(body, 'touchstart', 100, 100); body.scrollTop = 0;
  expect(touch(body, 'touchmove', 100, 280).defaultPrevented).toBe(false);
  touch(body, 'touchend', 100, 280);
  expect(panel).toBeInTheDocument(); expect(dismissed).not.toHaveBeenCalled();
  drag(body); expect(dismissed).toHaveBeenCalledOnce();
});
test('nested quote scroll is preserved while the header can always dismiss', () => {
  const { panel, header, dismissed } = show(); const nested = screen.getByTestId('nested'); nested.scrollTop = 80;
  expect(drag(nested).defaultPrevented).toBe(false); expect(panel).toBeInTheDocument();
  drag(header); expect(dismissed).toHaveBeenCalledOnce();
});
test('upward and horizontal intent never switches to dismissal during the same touch', () => {
  const { body, dismissed } = show();
  for (const [x, y] of [[100, 70], [150, 105]]) {
    touch(body, 'touchstart', 100, 100); expect(touch(body, 'touchmove', x!, y!).defaultPrevented).toBe(false);
    touch(body, 'touchmove', 100, 300); touch(body, 'touchend', 100, 300);
  }
  expect(dismissed).not.toHaveBeenCalled();
});
test('small and reversed pulls return the sheet without consuming the next control click', () => {
  const { body, panel, dismissed } = show();
  drag(body, 20); expect(panel.style.getPropertyValue('--sheet-drag-y')).toBe('');
  touch(body, 'touchstart', 100, 100); touch(body, 'touchmove', 100, 250); touch(body, 'touchmove', 100, 110); touch(body, 'touchend', 100, 110);
  expect(dismissed).not.toHaveBeenCalled();
  fireEvent.click(within(panel).getByRole('button', { name: 'Close' })); expect(dismissed).toHaveBeenCalledOnce();
});
test.each(['touchcancel', 'multitouch', 'contextmenu', 'resize', 'noncancelable'])('%s cancels the drag and leaves the sheet usable', kind => {
  const { body, panel, dismissed } = show();
  touch(body, 'touchstart', 100, 100); touch(body, 'touchmove', 100, 150);
  if (kind === 'touchcancel') touch(body, 'touchcancel', 100, 300);
  if (kind === 'multitouch') touch(body, 'touchmove', 100, 300, 2);
  if (kind === 'contextmenu') fireEvent.contextMenu(body);
  if (kind === 'resize') fireEvent(window, new Event('resize'));
  if (kind === 'noncancelable') touch(body, 'touchmove', 100, 300, 1, false);
  touch(body, 'touchend', 100, 300);
  expect(panel.style.getPropertyValue('--sheet-drag-y')).toBe(''); expect(dismissed).not.toHaveBeenCalled();
  drag(body); expect(dismissed).toHaveBeenCalledOnce();
});
test('editing, links and buttons do not become drag handles', () => {
  const { panel, dismissed } = show();
  expect(drag(within(panel).getByLabelText('Meaning')).defaultPrevented).toBe(false);
  expect(drag(within(panel).getByRole('button', { name: 'Translate' })).defaultPrevented).toBe(false);
  expect(dismissed).not.toHaveBeenCalled();
});
test('selecting translated text keeps native selection while the header remains a dismissal path', () => {
  const { panel, body, header, dismissed } = show();
  const text = within(panel).getByText('Long translation').firstChild!;
  const range = document.createRange(); range.selectNodeContents(text); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
  expect(drag(body).defaultPrevented).toBe(false); expect(dismissed).not.toHaveBeenCalled();
  drag(header); expect(dismissed).toHaveBeenCalledOnce(); window.getSelection()?.removeAllRanges();
});
test('the visual hint is remembered after exposure and static for reduced motion', () => {
  vi.useFakeTimers(); const view = show();
  expect(view.panel.querySelector('[data-swipe-teach]')).not.toBeNull();
  act(() => { vi.advanceTimersByTime(2500); });
  expect(view.panel.querySelector('[data-swipe-teach]')).toBeNull();
  fireEvent.click(within(view.panel).getByRole('button', { name: 'Close' }));
  fireEvent.click(view.trigger); expect(screen.getByRole('dialog').querySelector('[data-swipe-teach]')).toBeNull();
  cleanup(); localStorage.removeItem('reader.swipe-dismiss-hint.v1');
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: !q.includes('min-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const reduced = show(); expect(reduced.panel.querySelector('[data-swipe-teach]')).toBeNull(); expect(within(reduced.panel).getByText('Pull down to close')).toBeInTheDocument();
});
test('desktop rail has no gesture instruction and ignores touch dismissal', () => {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({ matches: q.includes('min-width'), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  const { panel, body, dismissed } = show();
  expect(panel.tagName).toBe('SECTION'); expect(within(panel).queryByText('Pull down to close')).toBeNull();
  drag(body); expect(dismissed).not.toHaveBeenCalled();
});
