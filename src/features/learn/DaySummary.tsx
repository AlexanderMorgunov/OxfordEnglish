import { Link } from 'react-router-dom';
import type { Day } from '@/content/schema';
import { useSessionResults } from '@/features/progress/sessionResults';
import { dayExercises } from '@/features/progress/completion';
import { Card, ProgressBar } from '@/shared/ui';

export type NextDay = { unitId: string; dayId: string; title: string };
type Props = {
  day: Day;
  next: NextDay | null;
  checkpointUnitId?: string | null;
  levelExitId?: string | null;
  onRedo?: () => void;
};

const nextClass =
  'inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-sm font-mono ' +
  'tracking-[0.02em] bg-teal text-ink font-semibold transition-[opacity,scale] duration-150 ' +
  'hover:opacity-90 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';

export function DaySummary({ day, next, checkpointUnitId, levelExitId, onRedo }: Props) {
  const results = useSessionResults((s) => s.results);
  const exercises = dayExercises(day);
  if (exercises.length === 0) return null;

  const attempted = exercises.filter((e) => results[e.id]);
  const done = attempted.length === exercises.length;
  const firstTry = attempted.filter((e) => results[e.id]?.firstCorrect).length;
  const missed = attempted.filter((e) => results[e.id] && !results[e.id]!.firstCorrect);
  const reviewTags = [...new Set(missed.flatMap((e) => results[e.id]?.tags ?? []))];

  return (
    <Card className={done ? 'border-teal-dim' : ''}>
      <p className="eyebrow mb-3.5">{done ? 'день завершён' : 'итоги дня'}</p>

      <ProgressBar value={attempted.length} max={exercises.length} label="упражнения" />

      <p className="mt-4 text-sm text-muted">
        С первой попытки:{' '}
        <span className="font-mono tabular-nums text-content">
          {firstTry} из {exercises.length}
        </span>
      </p>

      {reviewTags.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-content">Стоит повторить:</p>
          <div className="flex flex-wrap gap-1.5">
            {reviewTags.map((tag) => (
              <span
                key={tag}
                className="rounded-sm bg-surface-2 px-2 py-1 font-mono text-2xs text-amber"
              >
                {tag}
              </span>
            ))}
          </div>
          <Link
            to="/review"
            className="mt-3 inline-block font-mono text-xs text-teal hover:underline"
          >
            → повторить в тренажёре
          </Link>
        </div>
      ) : done ? (
        <p className="mt-4 text-sm text-teal">Отличная работа — без ошибок! ✓</p>
      ) : null}

      {levelExitId ? (
        <Link
          to={`/checkpoint/exit-${levelExitId.toLowerCase()}`}
          className="mt-4 block rounded-sm border border-teal-dim bg-teal-dim/10 px-3.5 py-2.5 text-sm hover:border-teal"
        >
          <span className="font-mono text-2xs uppercase tracking-[0.08em] text-teal">
            конец уровня {levelExitId}
          </span>
          <span className="ml-2">Пройти итоговый тест уровня {levelExitId} →</span>
        </Link>
      ) : (
        checkpointUnitId && (
          <Link
            to={`/checkpoint/${checkpointUnitId}`}
            className="mt-4 block rounded-sm border border-amber-dim bg-amber-dim/10 px-3.5 py-2.5 text-sm hover:border-amber"
          >
            <span className="font-mono text-2xs uppercase tracking-[0.08em] text-amber">
              конец юнита
            </span>
            <span className="ml-2">Пройти контрольную по юниту →</span>
          </Link>
        )
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {next ? (
          <Link to={`/course/${next.unitId}/day/${next.dayId}`} className={nextClass}>
            Следующий день →
          </Link>
        ) : (
          <Link to="/" className={nextClass}>
            На главную →
          </Link>
        )}
        {onRedo && (
          <button
            type="button"
            onClick={onRedo}
            className="font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:text-content"
          >
            ↻ пройти заново
          </button>
        )}
        {next && (
          <span className="font-mono text-2xs text-muted">
            {next.dayId} · {next.title}
          </span>
        )}
      </div>
    </Card>
  );
}
