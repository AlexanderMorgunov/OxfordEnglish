import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Eyebrow, PageStub } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import type { ParsedBook } from '@/features/reader/parse';
import { getCatalogEntry, openCatalogBook, type CatalogEntry } from '@/features/reader/catalog';
import { BookView } from '@/features/reader/BookView';

export function CatalogReaderPage() {
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

  if (state === 'loading') return <p className="font-mono text-sm text-muted">loading book…</p>;
  if (state === 'error' || !book || !entry) {
    return (
      <PageStub eyebrow="library" title={ru ? 'Книга не открылась' : 'Could not open the book'}>
        <p className="mb-3 text-sm text-muted">
          {ru ? 'Возможно, нужна сеть для загрузки этой книги.' : 'This book may need a connection to download.'}
        </p>
        <Link to="/library" className="font-mono text-teal hover:underline">
          ← {ru ? 'к библиотеке' : 'back to library'}
        </Link>
      </PageStub>
    );
  }

  return (
    <article>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <Eyebrow>
          {entry.level} · {book.title}
        </Eyebrow>
        <Link to="/library" className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline">
          ← {ru ? 'библиотека' : 'library'}
        </Link>
      </div>

      <BookView book={book} idPrefix={`reader.catalog.${entry.id}`} />

      <p className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-muted">
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
    </article>
  );
}
