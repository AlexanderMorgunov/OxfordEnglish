import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useContentStore } from '@/content/store';
import { Card, PixelImage } from '@/shared/ui';

export function DashboardPage() {
  const { status, pack, error, load } = useContentStore();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section aria-label="Dashboard">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-3.5">today</p>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-balance">
            English for <span className="text-amber">developers</span>
          </h1>
          <p className="max-w-prose text-lg text-muted text-pretty">
            A structured daily route from A2 to B1 — grammar, reading, listening
            and practice, in the language you already think in: commits.
          </p>
        </div>
        <PixelImage
          src="/assets/pixel/mascot.png"
          alt="A friendly terminal-headed robot mascot"
          width={96}
          height={96}
          className="hidden h-24 w-24 shrink-0 sm:block"
        />
      </div>

      {status === 'loading' && (
        <p className="font-mono text-sm text-muted">loading pack…</p>
      )}

      {status === 'error' && (
        <Card className="border-coral">
          <p className="font-mono text-sm text-coral">
            ✕ failed to load content pack
          </p>
          <p className="mt-2 text-sm text-muted">{error}</p>
        </Card>
      )}

      {status === 'ready' && pack && (
        <div className="flex flex-col gap-6">
          {pack.units.map((unit) => (
            <div key={unit.id}>
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-muted">
                {unit.title.en}
              </p>
              <div className="flex flex-col gap-2.5">
                {unit.days.map((day) => (
                  <Link
                    key={day.id}
                    to={`/course/${unit.id}/day/${day.id}`}
                    className="group flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3.5 transition-colors hover:border-teal-dim"
                  >
                    <span className="flex items-baseline gap-3">
                      <span className="font-mono text-xs text-teal">{day.id}</span>
                      <span className="text-base">{day.title.en}</span>
                    </span>
                    <span className="font-mono text-2xs tabular-nums text-muted">
                      ~{day.estimatedMinutes} min · {day.sections.length} sections
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
