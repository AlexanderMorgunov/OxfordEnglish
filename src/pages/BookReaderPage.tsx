import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BookRecord } from '@/db/db';
import { Button, Eyebrow, PageStub } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { getBook, openBook, saveProgress } from '@/features/reader/service';
import type { ParsedBook } from '@/features/reader/parse';
import { ReadingText } from '@/features/reader/reading-text';
import { ChapterStudy } from '@/features/reader/ChapterStudy';

export function BookReaderPage() {
  const { bookId } = useParams();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [record, setRecord] = useState<BookRecord | null>(null);
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [chapter, setChapter] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    if (!bookId) return;
    setState('loading');
    void (async () => {
      try {
        const rec = await getBook(bookId);
        if (!rec) throw new Error('not-found');
        const parsed = await openBook(rec);
        if (!alive) return;
        setRecord(rec);
        setBook(parsed);
        setChapter(Math.min(rec.lastChapter, parsed.chapters.length - 1));
        setState('ready');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

  const go = (idx: number) => {
    if (!book) return;
    const next = Math.max(0, Math.min(idx, book.chapters.length - 1));
    setChapter(next);
    if (record) void saveProgress(record.id, next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const paragraphs = useMemo(
    () => (book ? book.chapters[chapter]?.text.split(/\n{2,}/).filter(Boolean) ?? [] : []),
    [book, chapter]
  );

  if (state === 'loading') return <p className="font-mono text-sm text-muted">loading book…</p>;
  if (state === 'error' || !book || !record) {
    return (
      <PageStub eyebrow="library" title={ru ? 'Книга не открылась' : 'Could not open the book'}>
        <Link to="/library" className="font-mono text-teal hover:underline">
          ← {ru ? 'к библиотеке' : 'back to library'}
        </Link>
      </PageStub>
    );
  }

  const ch = book.chapters[chapter]!;
  const nav = (
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
  );

  return (
    <article>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <Eyebrow>{book.title}</Eyebrow>
        <Link to="/library" className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline">
          ← {ru ? 'библиотека' : 'library'}
        </Link>
      </div>

      {ch.title && <h1 className="mb-6 text-2xl font-bold tracking-tight text-balance">{ch.title}</h1>}

      <div className="mb-6">{nav}</div>

      <ReadingText paragraphs={paragraphs} />

      <ChapterStudy text={ch.text} idPrefix={`reader.${record.id}.${chapter}`} />

      <div className="mt-8 border-t border-line pt-5">{nav}</div>
    </article>
  );
}
