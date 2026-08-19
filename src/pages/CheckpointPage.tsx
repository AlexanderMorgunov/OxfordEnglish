import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Exercise } from '@/content/schema';
import { useContentStore } from '@/content/store';
import { Button, Card, Eyebrow, PageStub } from '@/shared/ui';
import { ExerciseView } from '@/features/practice/exercises/ExerciseView';
import { buildCheckpoint, buildLevelExit, reviewPlan } from '@/features/checkpoint/build';
import { skillMap, type TagStat } from '@/features/progress/metrics';
import { loadAttempts, saveCheckpoint } from '@/features/progress/queries';

type Result = {
  score: number;
  total: number;
  breakdown: TagStat[];
  plan: { tag: string; dayIds: string[] }[];
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Score needed on a level exit test to be judged ready for the next level. */
const EXIT_PASS = 0.8;
const NEXT_LEVEL: Record<string, string> = { A2: 'B1', B1: 'B2', B2: 'C1' };

export function CheckpointPage() {
  const { unitId } = useParams();
  const exitLevel = unitId?.startsWith('exit-') ? unitId.slice(5).toUpperCase() : null;
  const { status, pack, load } = useContentStore();
  const sessionStart = useRef(Date.now());
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (pack && unitId && !exercises) {
      setExercises(exitLevel ? buildLevelExit(pack, exitLevel) : buildCheckpoint(pack, unitId));
    }
  }, [pack, unitId, exitLevel, exercises]);

  const finish = useMemo(
    () => async () => {
      if (!pack || !unitId || !exercises) return;
      const since = (await loadAttempts()).filter(
        (a) => a.timestamp >= sessionStart.current
      );
      const firstCorrect = new Map<string, boolean>();
      for (const a of since) {
        if (!firstCorrect.has(a.exerciseId) || a.attemptNumber === 1) {
          firstCorrect.set(a.exerciseId, a.correct);
        }
      }
      const score = exercises.filter((e) => firstCorrect.get(e.id)).length;
      const breakdown = skillMap(since);
      const plan = reviewPlan(
        pack,
        breakdown.filter((b) => b.accuracy < 0.6).map((b) => b.tag)
      );
      await saveCheckpoint({
        unitId,
        timestamp: Date.now(),
        score,
        total: exercises.length,
        tagBreakdown: breakdown.map((b) => ({
          tag: b.tag,
          correct: b.correct,
          total: b.total,
        })),
      });
      setResult({ score, total: exercises.length, breakdown, plan });
    },
    [pack, unitId, exercises]
  );

  if (status === 'idle' || status === 'loading') {
    return <p className="font-mono text-sm text-muted">loading…</p>;
  }
  if (!exercises || exercises.length === 0) {
    return <PageStub eyebrow="checkpoint" title="Nothing to test yet" />;
  }

  if (result) {
    const ratio = result.score / result.total;
    const passed = ratio >= EXIT_PASS;
    const nextLevel = exitLevel ? NEXT_LEVEL[exitLevel] : null;
    return (
      <section aria-label="Checkpoint result">
        <Eyebrow className="mb-3.5">
          {exitLevel ? `${exitLevel} exit test` : unitId} · result
        </Eyebrow>
        <h1 className="mb-2 text-3xl font-bold tracking-tight tabular-nums">
          {pct(ratio)}
        </h1>
        <p className="mb-8 text-muted">
          {result.score} / {result.total} on first try
        </p>

        {exitLevel && (
          <Card className={`mb-8 ${passed ? 'border-teal-dim' : 'border-amber-dim'}`}>
            {passed ? (
              <p className="text-base">
                <span className="font-mono text-2xs uppercase tracking-[0.08em] text-teal">
                  passed
                </span>
                <span className="ml-2">
                  Отличный результат — ты готов к уровню {nextLevel}! 🎉
                </span>
              </p>
            ) : (
              <p className="text-base">
                <span className="font-mono text-2xs uppercase tracking-[0.08em] text-amber">
                  почти
                </span>
                <span className="ml-2">
                  Нужно {pct(EXIT_PASS)}, чтобы перейти на {nextLevel}. Повтори слабые
                  темы ниже и попробуй снова.
                </span>
              </p>
            )}
          </Card>
        )}

        <p className="mb-3 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          by tag
        </p>
        <div className="mb-8 flex flex-col gap-2">
          {result.breakdown.map((b) => (
            <div key={b.tag} className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-sm">{b.tag}</span>
              <span className="font-mono text-sm tabular-nums text-muted">
                {pct(b.accuracy)}
              </span>
            </div>
          ))}
        </div>

        {result.plan.length > 0 && (
          <Card className="border-amber-dim">
            <p className="mb-2 font-mono text-2xs uppercase tracking-[0.08em] text-amber">
              review plan
            </p>
            <ul className="flex flex-col gap-2">
              {result.plan.map((p) => (
                <li key={p.tag} className="text-sm">
                  <span className="font-mono text-content">{p.tag}</span>{' '}
                  <span className="text-muted">— revisit </span>
                  {p.dayIds.map((id, i) => (
                    <span key={id}>
                      {i > 0 && <span className="text-muted">, </span>}
                      <Link
                        to={`/course/${id.split('.')[0]}/day/${id}`}
                        className="font-mono text-teal hover:underline"
                      >
                        {id}
                      </Link>
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Checkpoint">
      <Eyebrow className="mb-3.5">
        {exitLevel ? `${exitLevel} exit test` : `${unitId} · checkpoint`}
      </Eyebrow>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">
        {exitLevel ? `${exitLevel} exit test` : 'Unit checkpoint'}
      </h1>
      <p className="mb-8 text-muted">
        {exitLevel
          ? `${exercises.length} questions from across ${exitLevel}. Score ${pct(
              EXIT_PASS
            )} to be ready for the next level.`
          : `${exercises.length} mixed questions, interleaved. Answer them, then finish for a per-tag report.`}
      </p>

      <div className="flex flex-col gap-3.5">
        {exercises.map((exercise, i) => (
          <ExerciseView key={`${exercise.id}.${i}`} exercise={exercise} />
        ))}
      </div>

      <Button className="mt-6" onClick={() => void finish()}>
        {exitLevel ? 'Finish test' : 'Finish checkpoint'}
      </Button>
    </section>
  );
}
