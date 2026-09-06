import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import type { ParsedBook } from './parse';
import { paginateChapters } from './paginate';
import { ReadingText } from './reading-text';
import { ChapterStudy } from './ChapterStudy';
import { BookQuestion } from './BookQuestion';
import { ReaderWidget } from './ReaderWidget';
import { toSentences } from './parse/text';
import {
  listBookmarks,
  toggleBookmark,
  removeBookmark,
  snippetOf,
  topVisibleParagraph,
  resolvePageIndex,
  resolveParagraphIndex,
  resolveSentenceIndex,
  type Bookmark,
} from './bookmarks';

const splitParas = (text: string) => text.split(/\n{2,}/).filter(Boolean);

/** Shared reader view: chapter navigation, reading text, bookmarks, and the chapter study panel. */
export function BookView({
  book,
  idPrefix,
  initialChapter = 0,
  onChapter,
}: {
  book: ParsedBook;
  idPrefix: string;
  initialChapter?: number;
  onChapter?: (index: number) => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  // Long chapters are paginated so one render never mounts tens of thousands of word tokens.
  const chapters = useMemo(() => paginateChapters(book.chapters), [book]);
  const [chapter, setChapter] = useState(Math.min(Math.max(initialChapter, 0), chapters.length - 1));

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  // A jump carries a nonce so a bookmark on the *current* page (no chapter change) still scrolls:
  // an effect keyed on `chapter` would bail out. `jumpingRef` tells the scroll-restore effect to
  // yield so the two don't fight over the scroll position.
  const [jump, setJump] = useState<{ paragraph: number; sentence: number | null; nonce: number } | null>(
    null
  );
  const jumpingRef = useRef(false);
  const nonceRef = useRef(0);
  const reduceMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    []
  );

  const reloadBookmarks = () => void listBookmarks(idPrefix).then(setBookmarks);
  useEffect(() => {
    void listBookmarks(idPrefix).then(setBookmarks);
  }, [idPrefix]);

  const go = (idx: number) => {
    const next = Math.max(0, Math.min(idx, chapters.length - 1));
    setChapter(next);
    onChapter?.(next);
  };

  // Persist and restore the scroll position per chapter, so a reader resumes exactly where
  // they left off (not just at the chapter top).
  useEffect(() => {
    const key = `${idPrefix}.pos.${chapter}`;
    const restore = !jumpingRef.current; // a pending bookmark jump owns the scroll instead
    let saved = 0;
    try {
      saved = Number(localStorage.getItem(key)) || 0;
    } catch {
      // ignore
    }
    // Ignore scroll writes until the initial restore has run, and once the reading text has left the
    // DOM (navigating away): otherwise the window's snap to 0 — RR scrolling the next, shorter page to
    // top while this listener is still attached — clobbers the saved position with 0.
    let restored = !restore;
    const raf = restore
      ? requestAnimationFrame(() => {
          window.scrollTo(0, saved);
          restored = true;
        })
      : 0;
    let writeRaf = 0;
    const onScroll = () => {
      if (!restored || !document.querySelector('[data-para]')) return;
      cancelAnimationFrame(writeRaf);
      writeRaf = requestAnimationFrame(() => {
        try {
          localStorage.setItem(key, String(Math.round(window.scrollY)));
        } catch {
          // best-effort
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(writeRaf);
      window.removeEventListener('scroll', onScroll);
    };
  }, [idPrefix, chapter]);

  // Scroll to a bookmarked paragraph after navigation (or in-place). Runs on the jump nonce so a
  // same-page jump still fires; clears jumpingRef once the scroll is scheduled.
  useEffect(() => {
    if (!jump) return;
    const raf = requestAnimationFrame(() => {
      const sent =
        jump.sentence != null
          ? document.querySelector(`[data-sent="${jump.paragraph}:${jump.sentence}"]`)
          : null;
      (sent ?? document.querySelector(`[data-para="${jump.paragraph}"]`))?.scrollIntoView({
        block: 'start',
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
      jumpingRef.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [jump, reduceMotion]);

  const ch = chapters[chapter]!;
  const paragraphs = useMemo(() => splitParas(ch.text), [ch]);
  const multi = chapters.length > 1;

  // Which sentences on the current page are bookmarked (keys `${para}:${sentence}`) — drives the
  // lens-menu заложить/убрать label. Matched on the stable pageId (like the jump path).
  const bookmarkedSentences = useMemo(() => {
    const s = new Set<string>();
    for (const bm of bookmarks) if (bm.pageId === ch.id && bm.sentence != null) s.add(`${bm.paragraph}:${bm.sentence}`);
    return s;
  }, [bookmarks, ch.id]);

  // Precise: anchor a bookmark to a specific sentence (from the per-sentence lens menu).
  const toggleSentenceBookmark = async (p: number, si: number, sentence: string) => {
    await toggleBookmark({
      bookKey: idPrefix,
      page: chapter,
      paragraph: p,
      sentence: si,
      pageId: ch.id,
      snippet: snippetOf(sentence),
      chapterTitle: ch.title,
      scrollY: Math.round(window.scrollY),
    });
    reloadBookmarks();
  };

  // Quick: bookmark the current spot — the first sentence of the top-visible paragraph (widget).
  const toggleHere = async () => {
    const rects = Array.from(document.querySelectorAll<HTMLElement>('[data-para]')).map((el) => ({
      index: Number(el.dataset.para),
      top: el.getBoundingClientRect().top,
    }));
    const p = topVisibleParagraph(rects);
    if (p == null) return { added: false };
    const firstSentence = toSentences(paragraphs[p] ?? '')[0] ?? paragraphs[p] ?? '';
    const res = await toggleBookmark({
      bookKey: idPrefix,
      page: chapter,
      paragraph: p,
      sentence: 0,
      pageId: ch.id,
      snippet: snippetOf(firstSentence),
      chapterTitle: ch.title,
      scrollY: Math.round(window.scrollY),
    });
    reloadBookmarks();
    return res;
  };

  const jumpTo = (bm: Bookmark) => {
    const page = resolvePageIndex(chapters, bm.pageId, bm.page);
    const paras = splitParas(chapters[page]!.text);
    const para = resolveParagraphIndex(paras, bm.paragraph, bm.snippet);
    const sentence = resolveSentenceIndex(toSentences(paras[para] ?? ''), bm.sentence, bm.snippet);
    jumpingRef.current = true;
    setJump({ paragraph: para, sentence, nonce: (nonceRef.current += 1) });
    go(page);
    setPanelOpen(false);
  };

  const deleteBookmark = async (id: string) => {
    await removeBookmark(id);
    reloadBookmarks();
  };

  const nav = multi ? (
    <div className="flex items-center justify-between gap-3">
      <Button variant="ghost" size="sm" disabled={chapter === 0} onClick={() => go(chapter - 1)}>
        ← {ru ? 'назад' : 'prev'}
      </Button>
      <select
        aria-label={ru ? 'Глава' : 'Chapter'}
        value={chapter}
        onChange={(e) => go(Number(e.target.value))}
        className="max-w-[55%] truncate rounded-sm border border-line bg-surface px-2 py-1 font-mono text-xs text-muted"
      >
        {chapters.map((c, i) => (
          <option key={c.id} value={i}>
            {i + 1}. {c.title ?? (ru ? 'Глава' : 'Chapter') + ' ' + (i + 1)}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        disabled={chapter >= chapters.length - 1}
        onClick={() => go(chapter + 1)}
      >
        {ru ? 'далее' : 'next'} →
      </Button>
    </div>
  ) : null;

  return (
    <>
      {ch.title && <h1 className="mb-6 text-2xl font-bold tracking-tight text-balance">{ch.title}</h1>}
      {nav && <div className="mb-4">{nav}</div>}

      {bookmarks.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((v) => !v)}
          >
            🔖 {ru ? 'Закладки' : 'Bookmarks'} ({bookmarks.length})
          </Button>
        </div>
      )}

      {panelOpen && bookmarks.length > 0 && (
        <ul className="mb-6 flex flex-col gap-1.5 rounded-md border border-line bg-surface-2 p-2" aria-label={ru ? 'Закладки' : 'Bookmarks'}>
          {bookmarks.map((bm) => (
            <li key={bm.id} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => jumpTo(bm)}
                className="flex-1 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              >
                <span className="font-mono text-2xs text-muted">
                  {ru ? 'стр.' : 'p.'} {bm.page + 1}
                  {bm.chapterTitle ? ` · ${bm.chapterTitle}` : ''}
                </span>
                <span className="mt-0.5 block text-content">{bm.snippet}</span>
              </button>
              <button
                type="button"
                aria-label={ru ? 'Удалить закладку' : 'Delete bookmark'}
                onClick={() => void deleteBookmark(bm.id)}
                className="shrink-0 rounded-sm px-2 py-1.5 text-muted hover:text-coral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <ReadingText
        paragraphs={paragraphs}
        bookmarkedSentences={bookmarkedSentences}
        onBookmarkSentence={(p, si, s) => void toggleSentenceBookmark(p, si, s)}
      />
      <BookQuestion pageText={ch.text} />
      <ChapterStudy text={ch.text} idPrefix={`${idPrefix}.${chapter}`} />
      {nav && <div className="mt-8 border-t border-line pt-5">{nav}</div>}
      <ReaderWidget onBookmarkHere={toggleHere} />
    </>
  );
}
