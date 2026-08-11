import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Exercise } from '@/content/schema';
import { useContentStore } from '@/content/store';
import { useLearner } from '@/features/learner/store';
import { useSessionResults } from '@/features/progress/sessionResults';
import {
  buildPlacement,
  scorePlacement,
  type Band,
  type BandScore,
} from '@/features/placement/build';
import { ExerciseView } from '@/features/practice/exercises/ExerciseView';
import { Button, Card, Eyebrow, PageStub } from '@/shared/ui';

type PlItem = { band: Band; id: string; exercise: Exercise };

const BAND_LABEL: Record<Band, string> = { easy: 'basics', mid: 'A2 core', hard: 'A2 → B1' };

export function PlacementPage() {
  const { status, pack, load } = useContentStore();
  const setPlacement = useLearner((s) => s.setPlacement);
  const results = useSessionResults((s) => s.results);

  useEffect(() => {
    void load();
  }, [load]);

  // Salt ids per mount so placement answers never match real day exercises
  // (progress/completion key on the original id) and retakes start clean.
  const items = useMemo<PlItem[]>(() => {
    if (!pack) return [];
    const runId = Date.now();
    return buildPlacement(pack).map(({ band, exercise }, i) => ({
      band,
      id: `pl.${runId}.${i}.${exercise.id}`,
      exercise: { ...exercise, id: `pl.${runId}.${i}.${exercise.id}`, tags: [] } as Exercise,
    }));
  }, [pack]);

  const [done, setDone] = useState(false);

  const outcome = useMemo(() => {
    const empty: Record<Band, BandScore> = {
      easy: { correct: 0, total: 0 },
      mid: { correct: 0, total: 0 },
      hard: { correct: 0, total: 0 },
    };
    for (const it of items) {
      empty[it.band].total += 1;
      if (results[it.id]?.firstCorrect) empty[it.band].correct += 1;
    }
    return { scores: empty, ...scorePlacement(empty) };
  }, [items, results]);

  const answered = items.filter((it) => results[it.id]).length;

  if (status === 'idle' || status === 'loading') {
    return <p className="font-mono text-sm text-muted">loading…</p>;
  }
  if (items.length === 0) {
    return <PageStub eyebrow="placement" title="No diagnostic available" />;
  }

  if (done) {
    const unit = pack?.units.find((u) => u.id === outcome.recommendedUnitId);
    const firstDay = unit?.days[0];
    return (
      <section aria-label="Placement result" className="max-w-prose">
        <Eyebrow className="mb-3.5">placement · result</Eyebrow>
        <h1 className="mb-2 text-3xl font-bold tracking-tight">
          Your level: <span className="text-amber">{outcome.level}</span>
        </h1>
        <p className="mb-8 text-lg text-muted text-pretty">{outcome.message}</p>

        <div className="mb-8 flex flex-wrap gap-2">
          {(['easy', 'mid', 'hard'] as Band[]).map((b) => (
            <span
              key={b}
              className="rounded-sm bg-surface-2 px-2.5 py-1.5 font-mono text-2xs text-muted tabular-nums"
            >
              {BAND_LABEL[b]}: {outcome.scores[b].correct}/{outcome.scores[b].total}
            </span>
          ))}
        </div>

        {unit && firstDay && (
          <Card className="border-teal-dim">
            <p className="mb-1 font-mono text-2xs uppercase tracking-[0.08em] text-teal">
              recommended start
            </p>
            <p className="mb-4 text-lg">
              {unit.title.en}{' '}
              <span className="font-mono text-sm text-muted">· {firstDay.id}</span>
            </p>
            <Link
              to={`/course/${unit.id}/day/${firstDay.id}`}
              className="inline-flex items-center gap-2 rounded-sm bg-teal px-4 py-2.5 text-sm font-mono font-semibold text-ink transition-opacity hover:opacity-90"
            >
              Start here →
            </Link>
          </Card>
        )}

        <p className="mt-6 text-sm text-muted">
          You can start anywhere — this is just a suggestion.{' '}
          <Link to="/" className="text-teal hover:underline">
            Go to all units
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Placement test" className="max-w-prose">
      <Eyebrow className="mb-3.5">placement · {answered}/{items.length}</Eyebrow>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Where should you start?</h1>
      <p className="mb-8 text-muted text-pretty">
        {items.length} quick questions, from easy to harder. Answer what you can and
        skip the rest — we'll suggest a starting point. Nothing here counts towards
        your progress.
      </p>

      <div className="flex flex-col gap-3.5">
        {items.map((it) => (
          <ExerciseView key={it.id} exercise={it.exercise} />
        ))}
      </div>

      <Button
        className="mt-6"
        onClick={() => {
          setPlacement(outcome.level, outcome.recommendedUnitId);
          setDone(true);
        }}
      >
        See my result
      </Button>
    </section>
  );
}
