import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import { PageStub } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import type { ParsedBook } from '@/features/reader/parse';
import {
  getCatalogEntry,
  openCatalogBook,
  type CatalogEntry,
} from '@/features/reader/catalog';
import { BookView } from '@/features/reader/BookView';
import { RelatedShelf } from '@/features/reader/RelatedShelf';

// Catalog books have no DB record, so their last-read chapter lives in localStorage (imported books
// persist it via `lastChapter`). Keeps a return-from-vocabulary landing on the right chapter.
const chapterKey = (id: string) => `reader.catalog.${id}.chapter`;
function readCatalogChapter(id: string): number {
  try {
    return Number(localStorage.getItem(chapterKey(id))) || 0;
  } catch {
    return 0;
  }
}
function saveCatalogChapter(id: string, i: number) {
  localStorage.setItem(chapterKey(id), String(i));
}

export function CatalogReaderPage() {
  const location = useLocation();
  const libraryReturn =
    location.state?.libraryReturn === '/library'
      ? '/library'
      : '/library/catalog';
  const { catalogId } = useParams();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    if (!catalogId) return;
    setState('loading');
    void (async () => {
      try {
        const e = await getCatalogEntry(catalogId);
        if (!e) throw new Error('not-found');
        const parsed = await openCatalogBook(e);
        if (!alive) return;
        setEntry(e);
        setBook(parsed);
        setState('ready');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [catalogId]);

  if (state === 'loading')
    return (
      <p role="status" className="font-mono text-sm text-muted">
        {ru ? 'Открываем книгу…' : 'Opening the book…'}
      </p>
    );
  if (state === 'error' || !book || !entry) {
    return (
      <PageStub
        eyebrow="library"
        title={ru ? 'Книга не открылась' : 'Could not open the book'}
      >
        <p className="mb-3 text-sm text-muted">
          {ru
            ? 'Возможно, нужна сеть для загрузки этой книги.'
            : 'This book may need a connection to download.'}
        </p>
        <Link
          to={libraryReturn}
          className="font-mono text-teal hover:underline"
        >
          ← {ru ? 'к библиотеке' : 'back to library'}
        </Link>
      </PageStub>
    );
  }

  return (
    <article className="rd-book-page">
      <BookView
        book={book}
        idPrefix={`reader.catalog.${entry.id}`}
        initialChapter={readCatalogChapter(entry.id)}
        onChapter={(i) => saveCatalogChapter(entry.id, i)}
        libraryReturn={libraryReturn}
        level={entry.level}
      />

      <div className="rd-catalog-meta">
        <p className="border-t border-line pt-5 text-xs leading-relaxed text-muted">
          {ru ? 'Свободная лицензия: ' : 'Free license: '}
          {entry.license.attribution} ·{' '}
          <a
            href={entry.license.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal hover:underline"
          >
            {ru ? 'источник' : 'source'}
          </a>
        </p>

        <RelatedShelf current={entry} />
      </div>
    </article>
  );
}
