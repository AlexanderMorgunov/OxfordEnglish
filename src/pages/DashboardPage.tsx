import { Link } from 'react-router-dom';

export function DashboardPage() {
  return (
    <section aria-label="Dashboard">
      <p className="eyebrow mb-3.5">today · day 01</p>
      <h1 className="mb-2 text-3xl font-bold tracking-tight">
        English for <span className="text-amber">developers</span>
      </h1>
      <p className="mb-8 max-w-prose text-lg text-muted">
        A structured daily route from A2 to B1 — grammar, reading, listening and
        practice, in the language you already think in: commits.
      </p>

      <div className="card-exercise">
        <p className="mb-1 font-mono text-xs uppercase tracking-[0.14em] text-muted">
          next up
        </p>
        <p className="mb-4 text-lg">Unit 01 · Day 01 — The Past Simple</p>
        <Link
          to="/course/u01/day/u01.d01"
          className="inline-block rounded-sm bg-teal px-4 py-2.5 font-mono text-sm font-semibold text-ink transition-opacity hover:opacity-90"
        >
          Start the day →
        </Link>
      </div>
    </section>
  );
}
