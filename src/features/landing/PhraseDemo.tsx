import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';

const TOKENS = ['Alice', 'had', 'to', 'make', 'up', 'her', 'mind', 'before', 'the', 'Rabbit', 'ran', 'away.'];
/** The idiom the demo builds: its words are useless one by one, which is the whole point of phrases. */
const PHRASE = { from: 3, to: 6, ru: 'принять решение', en: 'to decide' };

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The reader's phrase picking: tap a word, arm "select phrase", then tap the last word. Plays itself
 *  once when scrolled into view, and hands control over as soon as the visitor taps anything. */
export function PhraseDemo() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [picked, setPicked] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const timers = useRef<number[]>([]);

  const stopAutoplay = () => {
    touched.current = true;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || touched.current) return;
        io.disconnect();
        const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
        if (reduceMotion()) {
          at(300, () => {
            setAnchor(PHRASE.from);
            setEnd(PHRASE.to);
          });
          return;
        }
        at(500, () => setPicked(PHRASE.from));
        at(1500, () => {
          setPicked(null);
          setAnchor(PHRASE.from);
        });
        // Extend one word at a time — the sweep is what makes the gesture readable.
        for (let i = PHRASE.from + 1; i <= PHRASE.to; i++) {
          at(1500 + (i - PHRASE.from) * 260, () => setEnd(i));
        }
      },
      { threshold: 0.4 }
    );
    io.observe(root);
    return () => {
      io.disconnect();
      timers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const tapWord = (i: number) => {
    stopAutoplay();
    if (anchor === null) {
      setPicked(picked === i ? null : i);
      return;
    }
    setEnd(i);
  };

  const armPhrase = () => {
    stopAutoplay();
    setAnchor(picked);
    setPicked(null);
    setEnd(null);
  };

  const reset = () => {
    stopAutoplay();
    setPicked(null);
    setAnchor(null);
    setEnd(null);
  };

  const lo = anchor === null ? null : Math.min(anchor, end ?? anchor);
  const hi = anchor === null ? null : Math.max(anchor, end ?? anchor);
  const inRange = (i: number) => lo !== null && hi !== null && i >= lo && i <= hi;
  const done = anchor !== null && end !== null;
  const selected = done ? TOKENS.slice(lo!, hi! + 1).join(' ').replace(/[.,]$/, '') : '';
  const isTarget = done && lo === PHRASE.from && hi === PHRASE.to;

  return (
    <div ref={rootRef} className="rounded-lg border border-line bg-surface p-4">
      <p className="mb-3 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
        {anchor === null
          ? ru
            ? 'нажмите слово, с которого начинается фраза'
            : 'tap the word the phrase starts with'
          : ru
            ? 'теперь нажмите последнее слово фразы'
            : 'now tap the last word of the phrase'}
      </p>

      <p className="text-lg leading-relaxed text-content [@media(pointer:coarse)]:select-none [@media(pointer:coarse)]:[-webkit-touch-callout:none]">
        {TOKENS.map((w, i) => (
          <span key={i}>
            <button
              type="button"
              aria-pressed={inRange(i)}
              onClick={() => tapWord(i)}
              className={cn(
                'cursor-pointer rounded-[2px] px-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
                inRange(i) ? 'bg-violet-dim text-content' : 'hover:bg-surface-2',
                picked === i && 'bg-surface-2 text-violet'
              )}
            >
              {w}
            </button>{' '}
          </span>
        ))}
      </p>

      <div aria-live="polite" className="mt-3">
        {picked !== null && anchor === null && (
          <div className="inline-flex flex-col gap-1 rounded-md border border-line bg-ink px-3 py-2">
            <span className="font-mono text-sm text-content">{TOKENS[picked]}</span>
            <button
              type="button"
              onClick={armPhrase}
              className="text-left font-mono text-2xs text-violet hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              {ru ? 'выделить фразу →' : 'select phrase →'}
            </button>
          </div>
        )}

        {done && (
          <div className="rounded-md border border-violet-dim bg-ink p-3.5">
            <p className="font-mono text-sm text-violet">«{selected}»</p>
            <p className="mt-1 text-sm text-content">
              {isTarget
                ? ru
                  ? PHRASE.ru
                  : PHRASE.en
                : ru
                  ? 'перевод подставится в приложении'
                  : 'the app fills in the translation'}
            </p>
            <p className="mt-1.5 font-mono text-2xs text-muted">
              {ru
                ? 'фраза сохраняется целиком и возвращается в повторениях'
                : 'the phrase is saved whole and comes back in review'}
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-2 font-mono text-2xs text-muted hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              {ru ? '↺ показать заново' : '↺ play again'}
            </button>
          </div>
        )}

        {picked === null && !done && (
          <p className="font-mono text-2xs text-faint">
            {ru
              ? 'идиому вроде «make up your mind» бесполезно учить по одному слову'
              : 'an idiom like “make up your mind” is useless word by word'}
          </p>
        )}
      </div>
    </div>
  );
}
