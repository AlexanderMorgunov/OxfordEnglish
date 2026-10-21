import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { hasBackToTop } from './back-to-top-routes';

function displayed(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  for (let ancestor: Element | null = el; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

export function BackToTop({ pathname, mainRef }: {
  pathname: string;
  mainRef: RefObject<HTMLElement | null>;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const allowed = hasBackToTop(pathname);
  const [visible, setVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!allowed) return;
    let frame = 0;
    let revealTimer = 0;
    let shown = false;
    let pastThreshold = false;
    let dirty = true;
    let controls: Element[] = [];
    const hide = () => {
      clearTimeout(revealTimer);
      revealTimer = 0;
      if (!shown) return;
      shown = false;
      if (rootRef.current?.contains(document.activeElement)) mainRef.current?.focus({ preventScroll: true });
      setVisible(false);
    };
    const sample = (settled = false) => {
      frame = 0;
      if (window.scrollY > window.innerHeight * 2) pastThreshold = true;
      else if (window.scrollY <= window.innerHeight) pastThreshold = false;
      const editing = document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      const dialog = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')].some(displayed);
      let blocked = false;
      const corner = rootRef.current?.getBoundingClientRect();
      if (pastThreshold && !editing && !dialog && corner) {
        if (dirty) {
          controls = [...document.querySelectorAll('a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"])')]
            .filter(el => !rootRef.current?.contains(el));
          dirty = false;
        }
        blocked = controls.some(el => [...el.getClientRects()].some(rect =>
          rect.width > 0 && rect.height > 0 && rect.left < corner.right + 4 && rect.right > corner.left - 4 && rect.top < corner.bottom + 4 && rect.bottom > corner.top - 4) && displayed(el));
      }
      if (!pastThreshold || editing || dialog || blocked) { hide(); return; }
      if (shown) return;
      clearTimeout(revealTimer);
      if (settled) { shown = true; setVisible(true); }
      else revealTimer = window.setTimeout(() => { revealTimer = 0; sample(true); }, 180);
    };
    const schedule = () => {
      clearTimeout(revealTimer);
      revealTimer = 0;
      if (!frame) frame = requestAnimationFrame(() => sample());
    };
    const changed = () => { dirty = true; schedule(); };
    const observer = new MutationObserver(records => { if (records.some(record => !rootRef.current?.contains(record.target))) changed(); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden', 'role', 'contenteditable', 'class', 'style'] });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', changed);
    document.fonts?.addEventListener('loadingdone', changed);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(revealTimer);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', changed);
      document.fonts?.removeEventListener('loadingdone', changed);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
    };
  }, [allowed, pathname, mainRef]);

  if (!allowed) return null;
  return <div ref={rootRef} className="pointer-events-none fixed z-20 h-12 w-12" style={{
    bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
    right: 'max(calc(0.5rem + env(safe-area-inset-right, 0px)), calc((100vw - 48rem) / 2 - 4rem))',
  }}>
    {visible && <button type="button" aria-label={ru ? 'Наверх' : 'Back to top'} title={ru ? 'Наверх' : 'Back to top'}
      className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-2xl text-teal shadow-md transition-colors hover:bg-surface-2"
      onClick={() => {
        mainRef.current?.focus({ preventScroll: true });
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      }}><span aria-hidden="true">↑</span></button>}
  </div>;
}
