import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { captureDataScope, subscribeDataScope } from '@/features/account/dataScope';
import { captureReadingPosition, readReadingPosition, restoreReadingPosition } from './reading-position';
import type { ReadingPosition } from './reading-position';

export function useReadingPosition({ rootRef, jumpingRef, storageKey, pageId }: {
  rootRef: RefObject<HTMLElement | null>;
  jumpingRef: RefObject<boolean>;
  storageKey: string;
  pageId: string;
}) {
  const cancelRestoreRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const root = rootRef.current?.querySelector<HTMLElement>('[data-reader-text]');
    if (!root) return;
    const owned = captureDataScope();
    let alive = true;
    let interrupted = jumpingRef.current;
    let restored = interrupted;
    let restoreFrame = 0;
    let writeFrame = 0;
    let latest: ReadingPosition | null = null;
    let saved: ReadingPosition | null = null;
    const startupUntil = Date.now() + 5000;
    try { saved = readReadingPosition(localStorage.getItem(storageKey), pageId); } catch { /* Storage can be unavailable. */ }
    const valid = () => alive && owned() && root.isConnected;
    const write = () => {
      if (!alive || !owned() || !latest) return;
      try { localStorage.setItem(storageKey, JSON.stringify(latest)); } catch { /* Best effort. */ }
    };
    const capture = () => {
      if (restored && valid()) latest = captureReadingPosition(root, pageId);
    };
    const restore = () => {
      restoreFrame = 0;
      if (jumpingRef.current) interrupt();
      if (!valid() || interrupted) return;
      restoreReadingPosition(root, saved ?? { version: 1, pageId, scrollY: 0 });
      restored = true;
      capture();
      write();
    };
    const scheduleRestore = () => {
      if (jumpingRef.current) interrupt();
      if (!valid() || interrupted) return;
      cancelAnimationFrame(restoreFrame);
      restoreFrame = requestAnimationFrame(restore);
    };
    const onScroll = () => {
      capture();
      if (!valid() || !restored) return;
      cancelAnimationFrame(writeFrame);
      writeFrame = requestAnimationFrame(write);
    };
    const interrupt = () => {
      interrupted = true;
      restored = true;
      cancelAnimationFrame(restoreFrame);
    };
    cancelRestoreRef.current = interrupt;
    const onLayout = () => {
      if (!valid()) return;
      if (!interrupted && Date.now() < startupUntil) scheduleRestore();
      else onScroll();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onLayout);
    if (rootRef.current) observer?.observe(rootRef.current);
    observer?.observe(root);
    const hide = () => { capture(); write(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') hide(); };
    const unsubscribe = subscribeDataScope(() => {
      interrupt();
      latest = null;
      cancelAnimationFrame(writeFrame);
      observer?.disconnect();
    });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('touchstart', interrupt, { passive: true });
    window.addEventListener('pointerdown', interrupt, { passive: true });
    window.addEventListener('keydown', interrupt);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', onVisibility);
    scheduleRestore();
    void document.fonts?.ready.then(scheduleRestore);
    return () => {
      // Persist the captured old DOM, never the replacement chapter or route's scroll.
      write();
      alive = false;
      cancelRestoreRef.current = () => {};
      cancelAnimationFrame(restoreFrame);
      cancelAnimationFrame(writeFrame);
      observer?.disconnect();
      unsubscribe();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', interrupt);
      window.removeEventListener('touchstart', interrupt);
      window.removeEventListener('pointerdown', interrupt);
      window.removeEventListener('keydown', interrupt);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [rootRef, jumpingRef, storageKey, pageId]);
  return () => cancelRestoreRef.current();
}
