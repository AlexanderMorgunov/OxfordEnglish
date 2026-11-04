import { useEffect, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const HINT_KEY = 'reader.swipe-dismiss-hint.v1';
let hintSeenWithoutStorage = false;

export function hasSeenSheetSwipeHint(): boolean {
  try { return localStorage.getItem(HINT_KEY) === '1'; }
  catch { return hintSeenWithoutStorage; }
}

export function markSheetSwipeHintSeen() {
  hintSeenWithoutStorage = true;
  try { localStorage.setItem(HINT_KEY, '1'); } catch { /* The session still remembers the hint. */ }
}

type Gesture = { id: number; x: number; y: number; mode: 'pending' | 'scroll' | 'drag'; header: boolean };
const CONTROLS = 'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"]';

export function useSheetDismiss(sheet: RefObject<HTMLDialogElement | null>, enabled: boolean, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  useLayoutEffect(() => { dismiss.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    const element = sheet.current;
    if (!enabled || !element) return;
    let gesture: Gesture | null = null;
    const selectionInside = () => {
      const selection = window.getSelection();
      return selection && !selection.isCollapsed &&
        (element.contains(selection.anchorNode) || element.contains(selection.focusNode));
    };
    const reset = () => {
      gesture = null;
      element.removeAttribute('data-dragging');
      element.style.removeProperty('--sheet-drag-y');
    };
    const start = (event: TouchEvent) => {
      reset();
      if (event.touches.length !== 1 || !(event.target instanceof Element) || event.target === element || event.target.closest(CONTROLS)) return;
      const header = Boolean(event.target.closest('.rdh-topline'));
      if (!header && selectionInside()) return;
      let scrolled = false;
      for (let node: Element | null = event.target; node && node !== element; node = node.parentElement) {
        if (node.scrollTop > 1) scrolled = true;
      }
      const touch = event.touches[0]!;
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, mode: scrolled ? 'scroll' : 'pending', header };
      element.querySelector('[data-swipe-teach]')?.removeAttribute('data-swipe-teach');
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1 || !gesture.header && selectionInside()) { reset(); return; }
      const touch = Array.from(event.touches).find(t => t.identifier === gesture?.id);
      if (!touch) { reset(); return; }
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (gesture.mode === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) >= 4) {
        gesture.mode = dy > Math.abs(dx) * 1.2 ? 'drag' : 'scroll';
      }
      if (gesture.mode !== 'drag') return;
      // Once native scrolling owns a touch, a later move cannot safely take it over.
      if (!event.cancelable) { reset(); return; }
      event.preventDefault();
      element.setAttribute('data-dragging', '');
      element.style.setProperty('--sheet-drag-y', `${Math.max(0, dy)}px`);
    };
    const end = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = Array.from(event.changedTouches).find(t => t.identifier === gesture?.id);
      const dy = touch ? touch.clientY - gesture.y : 0;
      const dx = touch ? Math.abs(touch.clientX - gesture.x) : Infinity;
      const threshold = Math.min(120, Math.max(72, element.getBoundingClientRect().height * 0.18));
      const shouldClose = event.touches.length === 0 && gesture.mode === 'drag' && dy >= threshold && dy > dx * 1.2;
      if (gesture.mode === 'drag' && event.cancelable) event.preventDefault();
      reset();
      if (shouldClose) { markSheetSwipeHintSeen(); dismiss.current(); }
    };
    const cancel = () => { reset(); };
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end, { passive: false });
    element.addEventListener('touchcancel', cancel);
    element.addEventListener('contextmenu', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      reset();
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
      element.removeEventListener('contextmenu', cancel);
      window.removeEventListener('resize', cancel);
    };
  }, [enabled, sheet]);
}
