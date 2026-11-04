import type { LoadedPack, LoadedUnit } from '@/content/loader';
import type { Day, Level } from '@/content/schema';
import type { ExerciseAttempt } from '@/db/db';
import { dayExerciseIds, dayProgress } from '@/features/progress/completion';
import type { DayProgress } from '@/features/progress/completion';

export type CourseLevel = Level | 'mixed';
export type WorkingDay = { packId: string; dayId: string };
export type CourseDay = { day: Day; unit: LoadedUnit; progress: DayProgress };
export type CourseGroup = {
  level: CourseLevel;
  units: LoadedUnit[];
  total: number;
  done: number;
};

export function unitLevel(unit: LoadedUnit, fallback: Level): CourseLevel {
  const levels = new Set(
    unit.days.flatMap((day) => (day.level ? [day.level] : []))
  );
  return levels.size > 1 ? 'mixed' : (levels.values().next().value ?? fallback);
}

export function courseModel(
  pack: LoadedPack,
  attempts: Pick<ExerciseAttempt, 'exerciseId' | 'correct'>[],
  work: WorkingDay | null,
  recommendedUnitId: string | null
) {
  const solved = new Set(
    attempts.filter((a) => a.correct === true).map((a) => a.exerciseId)
  );
  const attempted = new Set(attempts.map((a) => a.exerciseId));
  const days: CourseDay[] = pack.units.flatMap((unit) =>
    unit.days.map((day) => {
      const progress = dayProgress(day, solved);
      if (
        progress.state === 'new' &&
        dayExerciseIds(day).some((id) => attempted.has(id))
      )
        progress.state = 'in-progress';
      return { day, unit, progress };
    })
  );
  const byId = new Map(days.map((entry) => [entry.day.id, entry]));
  const unfinished = (entry: CourseDay) => entry.progress.state !== 'done';
  const partials = days.filter(
    (entry) => entry.progress.state === 'in-progress'
  );
  const working =
    work?.packId === pack.manifest.id ? byId.get(work.dayId) : undefined;
  const recommended = pack.units.find((unit) => unit.id === recommendedUnitId);
  const cursor =
    working?.progress.state === 'done'
      ? days.indexOf(working) + 1
      : Math.max(
          0,
          days.findIndex((entry) => entry.unit === recommended)
        );
  const candidate =
    working && unfinished(working)
      ? working
      : (partials[0] ??
        [...days.slice(cursor), ...days.slice(0, cursor)].find(unfinished));
  const levelOrder: CourseLevel[] = [
    'A1',
    'A2',
    'B1',
    'B2',
    'C1',
    'C2',
    'mixed',
  ];
  const groups: CourseGroup[] = levelOrder.flatMap((level) => {
    const units = pack.units.filter(
      (unit) => unitLevel(unit, pack.course.level) === level
    );
    if (!units.length) return [];
    const entries = units.flatMap((unit) =>
      unit.days.map((day) => byId.get(day.id)!)
    );
    return [
      {
        level,
        units,
        total: entries.length,
        done: entries.filter((entry) => entry.progress.state === 'done').length,
      },
    ];
  });
  const done = days.filter((entry) => entry.progress.state === 'done').length;
  return {
    days,
    byId,
    groups,
    partials,
    candidate,
    explicit: candidate != null && candidate === working,
    done,
    total: days.length,
    allDone: days.length > 0 && done === days.length,
  };
}

export type CourseModel = ReturnType<typeof courseModel>;

export function countLabel(
  n: number,
  ru: boolean,
  kind: 'day' | 'topic' | 'level' | 'card'
): string {
  if (!ru) return `${n} ${kind}${n === 1 ? '' : 's'}`;
  const forms = {
    day: ['день', 'дня', 'дней'],
    topic: ['тема', 'темы', 'тем'],
    level: ['уровень', 'уровня', 'уровней'],
    card: ['карточка', 'карточки', 'карточек'],
  }[kind];
  const form = new Intl.PluralRules('ru').select(n);
  return `${n} ${forms[form === 'one' ? 0 : form === 'few' ? 1 : 2]}`;
}
