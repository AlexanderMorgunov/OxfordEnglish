import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Day } from '@/content/schema';
import { useSessionResults } from '@/features/progress/sessionResults';
import { dayExercises } from '@/features/progress/completion';
import { track } from '@/features/analytics/analytics';
import { useUiLang } from '@/features/i18n/uiLang';
import { Card, ProgressBar } from '@/shared/ui';

export type NextDay = { unitId: string; dayId: string; title: string };

/** Days already counted this session — revisiting a finished day (e.g. back from /review)
 *  must not re-fire day_complete and inflate completion metrics. */
const tracked = new Set<string>();
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
  const ru = useUiLang((s) => s.lang) === 'ru';
  const results = useSessionResults((s) => s.results);
  const exercises = dayExercises(day);
  const total = exercises.length;

  const attempted = exercises.filter((e) => results[e.id]);
  const done = total > 0 && attempted.length === total;
  const firstTry = attempted.filter((e) => results[e.id]?.firstCorrect).length;
  const missed = attempted.filter((e) => results[e.id] && !results[e.id]!.firstCorrect);
  const reviewTags = [...new Set(missed.flatMap((e) => results[e.id]?.tags ?? []))];

  useEffect(() => {
    if (done && !tracked.has(day.id)) {
      tracked.add(day.id);
      void track('day_complete', { dayId: day.id, firstTry, total });
    }
  }, [done, day.id, firstTry, total]);

  if (total === 0) return null;

  return (
    <Card className={done ? 'border-teal-dim' : ''}>
      <p className="eyebrow mb-3.5">
        {done ? (ru ? 'день завершён' : 'day complete') : ru ? 'итоги дня' : 'day summary'}
      </p>

      <ProgressBar
        value={attempted.length}
        max={exercises.length}
        label={ru ? 'упражнения' : 'exercises'}
      />

      <p className="mt-4 text-sm text-muted">
        {ru ? 'С первой попытки: ' : 'First try: '}
        <span className="font-mono tabular-nums text-content">
          {firstTry} {ru ? 'из' : 'of'} {exercises.length}
        </span>
      </p>

      {reviewTags.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm text-content">{ru ? 'Стоит повторить:' : 'Worth reviewing:'}</p>
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
            {ru ? '→ повторить в тренажёре' : '→ practise in the trainer'}
          </Link>
        </div>
      ) : done ? (
        <p className="mt-4 text-sm text-teal">
          {ru ? 'Отличная работа — без ошибок! ✓' : 'Great work — no mistakes! ✓'}
        </p>
      ) : null}

      {levelExitId ? (
        <Link
          to={`/checkpoint/exit-${levelExitId.toLowerCase()}`}
          className="mt-4 block rounded-sm border border-teal-dim bg-teal-dim/10 px-3.5 py-2.5 text-sm hover:border-teal"
        >
          <span className="font-mono text-2xs uppercase tracking-[0.08em] text-teal">
            {ru ? `конец уровня ${levelExitId}` : `end of level ${levelExitId}`}
          </span>
          <span className="ml-2">
            {ru ? `Пройти итоговый тест уровня ${levelExitId} →` : `Take the ${levelExitId} exit test →`}
          </span>
        </Link>
      ) : (
        checkpointUnitId && (
          <Link
            to={`/checkpoint/${checkpointUnitId}`}
            className="mt-4 block rounded-sm border border-amber-dim bg-amber-dim/10 px-3.5 py-2.5 text-sm hover:border-amber"
          >
            <span className="font-mono text-2xs uppercase tracking-[0.08em] text-amber">
              {ru ? 'конец юнита' : 'end of unit'}
            </span>
            <span className="ml-2">
              {ru ? 'Пройти контрольную по юниту →' : 'Take the unit checkpoint →'}
            </span>
          </Link>
        )
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {next ? (
          <Link to={`/course/${next.unitId}/day/${next.dayId}`} className={nextClass}>
            {ru ? 'Следующий день →' : 'Next day →'}
          </Link>
        ) : (
          <Link to="/" className={nextClass}>
            {ru ? 'На главную →' : 'To dashboard →'}
          </Link>
        )}
        {onRedo && (
          <button
            type="button"
            onClick={onRedo}
            className="font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:text-content"
          >
            {ru ? '↻ пройти заново' : '↻ redo'}
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
