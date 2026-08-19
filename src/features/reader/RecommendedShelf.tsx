import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { loadCatalog, cachedCatalogIds, type CatalogEntry } from './catalog';

const ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function RecommendedShelf() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const level = useLearner((s) => s.level);
  const [books, setBooks] = useState<CatalogEntry[] | null>(null);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void loadCatalog().then(setBooks);
    void cachedCatalogIds().then(setCached);
  }, []);

  if (!books || books.length === 0) return null;

  const target = level ? ORDER.indexOf(level) : 2; // default around A2–B1
  const sorted = [...books].sort(
    (a, b) =>
      Math.abs(ORDER.indexOf(a.level) - target) - Math.abs(ORDER.indexOf(b.level) - target) ||
      a.level.localeCompare(b.level) ||
      a.title.localeCompare(b.title)
  );
  const shown = expanded ? sorted : sorted.slice(0, 6);

  return (
    <div className="mb-8">
      <p className="eyebrow mb-3">
        {ru ? 'Рекомендуем почитать' : 'Recommended reading'}
        {level ? ` · ${level}` : ''}
      </p>
      <div className="flex flex-col gap-2">
        {shown.map((b) => (
          <Card key={b.id} className="flex items-center justify-between gap-3">
            <Link to={`/library/catalog/${b.id}`} className="min-w-0 flex-1">
              <p className="truncate font-semibold">{b.title}</p>
              <p className="truncate font-mono text-2xs uppercase tracking-[0.06em] text-muted">
                {b.author ? `${b.author} · ` : ''}
                {b.license.type}
              </p>
            </Link>
            <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-teal">
              {b.level}
            </span>
            {(() => {
              const offline = b.kind === 'bundled' || cached.has(b.id);
              return (
                <span
                  className="shrink-0 font-mono text-2xs text-muted"
                  title={
                    offline
                      ? ru
                        ? 'доступна офлайн'
                        : 'available offline'
                      : ru
                        ? 'загрузится при открытии'
                        : 'downloads when opened'
                  }
                >
                  {offline ? '●' : '↓'}
                </span>
              );
            })()}
          </Card>
        ))}
      </div>
      {sorted.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
        >
          {expanded ? (ru ? 'свернуть' : 'show less') : ru ? `все книги (${sorted.length})` : `all books (${sorted.length})`}
        </button>
      )}
    </div>
  );
}
