import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { loadCatalog, relatedCatalog, type CatalogEntry } from './catalog';

/** "More like this" after a catalog book — same author/level, for narrow reading. */
export function RelatedShelf({ current }: { current: CatalogEntry }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [related, setRelated] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    void loadCatalog().then((books) => setRelated(relatedCatalog(books, current)));
  }, [current]);

  if (related.length === 0) return null;

  return (
    <div className="mt-10 border-t border-line pt-6">
      <p className="eyebrow mb-3">{ru ? 'Похожие книги' : 'More like this'}</p>
      <div className="flex flex-col gap-2">
        {related.map((b) => (
          <Link
            key={b.id}
            to={`/library/catalog/${b.id}`}
            className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-3 transition-colors hover:border-teal-dim"
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold">{b.title}</span>
              {b.author && (
                <span className="block truncate font-mono text-2xs uppercase tracking-[0.06em] text-muted">
                  {b.author}
                </span>
              )}
            </span>
            <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-teal">
              {b.level}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
