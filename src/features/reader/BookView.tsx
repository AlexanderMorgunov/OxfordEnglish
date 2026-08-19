import { useMemo, useState } from 'react';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import type { ParsedBook } from './parse';
import { ReadingText } from './reading-text';
import { ChapterStudy } from './ChapterStudy';

/** Shared reader view: chapter navigation, reading text, and the chapter study panel. */
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
  const [chapter, setChapter] = useState(Math.min(Math.max(initialChapter, 0), book.chapters.length - 1));

  const go = (idx: number) => {
    const next = Math.max(0, Math.min(idx, book.chapters.length - 1));
    setChapter(next);
    onChapter?.(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const ch = book.chapters[chapter]!;
  const paragraphs = useMemo(() => ch.text.split(/\n{2,}/).filter(Boolean), [ch]);
  const multi = book.chapters.length > 1;

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
        {book.chapters.map((c, i) => (
          <option key={c.id} value={i}>
            {i + 1}. {c.title ?? (ru ? 'Глава' : 'Chapter') + ' ' + (i + 1)}
          </option>
        ))}
      </select>
      <Button
        variant="ghost"
        size="sm"
        disabled={chapter >= book.chapters.length - 1}
        onClick={() => go(chapter + 1)}
      >
        {ru ? 'далее' : 'next'} →
      </Button>
    </div>
  ) : null;

  return (
    <>
      {ch.title && <h1 className="mb-6 text-2xl font-bold tracking-tight text-balance">{ch.title}</h1>}
      {nav && <div className="mb-6">{nav}</div>}
      <ReadingText paragraphs={paragraphs} />
      <ChapterStudy text={ch.text} idPrefix={`${idPrefix}.${chapter}`} />
      {nav && <div className="mt-8 border-t border-line pt-5">{nav}</div>}
    </>
  );
}
