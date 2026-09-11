import { useEffect, useRef } from 'react';
import { countWords } from '@/features/reader/position';
import { FLUSH_MS, POLL_MS, dwellNeededMs, isReading, pollCreditMs } from './accounting';
import { flushPending, recordActivity, setCurrentReading, stashPending } from './activity';

const THRESHOLDS = Array.from({ length: 11 }, (_, i) => i / 10);

/**
 * Active reading time and paragraphs actually read on the open book page, written to today's activity
 * row. Time accrues only while `isReading`; a paragraph counts once per page view after it has been on
 * screen, while reading, for its words at MAX_WPM — so jumping ahead or skimming past isn't "reading".
 */
export function useReadingTracker({
  bookKey,
  title,
  pageKey,
  paragraphs,
  onPosition,
}: {
  bookKey: string;
  title: string;
  pageKey: string;
  paragraphs: string[];
  /** The top visible paragraph whenever it changes while reading — the reader stores its % position. */
  onPosition?: (paragraph: number) => void;
}) {
  const wordsRef = useRef<number[]>([]);
  const visibleRef = useRef(new Set<number>());
  const dwellRef = useRef(new Map<number, number>());
  const creditedRef = useRef(new Set<number>());
  const topRef = useRef<number | null>(null);
  const onPositionRef = useRef(onPosition);
  useEffect(() => {
    onPositionRef.current = onPosition;
  });

  useEffect(() => {
    wordsRef.current = paragraphs.map(countWords);
    visibleRef.current = new Set();
    dwellRef.current = new Map();
    creditedRef.current = new Set();
    topRef.current = null;
    if (typeof IntersectionObserver === 'undefined') return;
    // "On screen" = at least half the paragraph visible, or it fills half the viewport (a paragraph
    // taller than the screen never reaches a 50 % ratio).
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const p = Number((e.target as HTMLElement).dataset.para);
          const fills = e.rootBounds ? e.intersectionRect.height >= e.rootBounds.height / 2 : false;
          if (e.isIntersecting && (e.intersectionRatio >= 0.5 || fills)) visibleRef.current.add(p);
          else visibleRef.current.delete(p);
        }
      },
      { threshold: THRESHOLDS }
    );
    document.querySelectorAll('[data-para]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pageKey, paragraphs]);

  useEffect(() => {
    const book = { key: bookKey, title };
    setCurrentReading(book);
    void flushPending();
    let lastInput = Date.now();
    let lastPoll = Date.now();
    let pendingMs = 0;
    let pendingWords = 0;

    const reading = (now: number) =>
      isReading({
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        speaking: 'speechSynthesis' in window && window.speechSynthesis.speaking,
        sinceInputMs: now - lastInput,
      });
    const take = () => {
      const sec = Math.floor(pendingMs / 1000);
      pendingMs -= sec * 1000;
      const words = pendingWords;
      pendingWords = 0;
      return { sec, words };
    };
    const write = () => {
      const { sec, words } = take();
      if (sec || words) void recordActivity({ readSec: sec, readWords: words, book: { ...book, sec, words } });
    };
    // Can't await IndexedDB here (pagehide / unmount racing the next page's read) — stash
    // synchronously; `flushPending` folds it in before anything reads the stats.
    const stash = () => {
      const { sec, words } = take();
      if (sec || words) stashPending({ ts: Date.now(), sec, words, book });
    };

    const poll = () => {
      const now = Date.now();
      const credit = pollCreditMs(now - lastPoll);
      lastPoll = now;
      if (!reading(now)) return;
      pendingMs += credit;
      for (const p of visibleRef.current) {
        const dwell = (dwellRef.current.get(p) ?? 0) + credit;
        dwellRef.current.set(p, dwell);
        const words = wordsRef.current[p] ?? 0;
        if (!creditedRef.current.has(p) && dwell >= dwellNeededMs(words)) {
          creditedRef.current.add(p);
          pendingWords += words;
        }
      }
      if (visibleRef.current.size) {
        const top = Math.min(...visibleRef.current);
        if (top !== topRef.current) {
          topRef.current = top;
          onPositionRef.current?.(top);
        }
      }
      if (pendingMs >= FLUSH_MS) write();
    };

    const onInput = () => {
      lastInput = Date.now();
    };
    const onHide = () => {
      if (document.visibilityState === 'visible') lastPoll = Date.now();
      else stash();
    };

    const timer = window.setInterval(poll, POLL_MS);
    window.addEventListener('scroll', onInput, { passive: true });
    window.addEventListener('pointerdown', onInput);
    window.addEventListener('keydown', onInput);
    window.addEventListener('touchstart', onInput, { passive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', onInput);
      window.removeEventListener('pointerdown', onInput);
      window.removeEventListener('keydown', onInput);
      window.removeEventListener('touchstart', onInput);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      stash();
      setCurrentReading(null);
    };
  }, [bookKey, title]);
}

/** A book's stored reading position (0–1), or null when never read. */
export function readProgress(bookKey: string): number | null {
  try {
    const v = Number(localStorage.getItem(`${bookKey}.progress`));
    return v > 0 ? Math.min(v, 1) : null;
  } catch {
    return null;
  }
}

export function saveProgress(bookKey: string, fraction: number): void {
  try {
    localStorage.setItem(`${bookKey}.progress`, fraction.toFixed(4));
  } catch {
    // best-effort
  }
}
