import type { ExerciseAttempt } from '@/db/db';
import type { Day } from '@/content/schema';
import type { LoadedUnit } from '@/content/loader';

export type CompletionState = 'new' | 'in-progress' | 'done';

export type DayProgress = {
  state: CompletionState;
  completed: number;
  total: number;
};

export type UnitProgress = {
  state: CompletionState;
  doneDays: number;
  totalDays: number;
};

export function dayExerciseIds(day: Day): string[] {
  const ids: string[] = [];
  for (const section of day.sections) {
    if (section.type === 'practice' || section.type === 'listening') {
      for (const exercise of section.exercises) ids.push(exercise.id);
    }
  }
  return ids;
}

export function solvedExerciseIds(attempts: ExerciseAttempt[]): Set<string> {
  const solved = new Set<string>();
  for (const a of attempts) if (a.correct) solved.add(a.exerciseId);
  return solved;
}

export function dayProgress(day: Day, solved: Set<string>): DayProgress {
  const ids = dayExerciseIds(day);
  if (ids.length === 0) return { state: 'new', completed: 0, total: 0 };
  const completed = ids.filter((id) => solved.has(id)).length;
  const state: CompletionState =
    completed === ids.length ? 'done' : completed > 0 ? 'in-progress' : 'new';
  return { state, completed, total: ids.length };
}

export function unitProgress(unit: LoadedUnit, solved: Set<string>): UnitProgress {
  const totalDays = unit.days.length;
  if (totalDays === 0) return { state: 'new', doneDays: 0, totalDays: 0 };
  const states = unit.days.map((d) => dayProgress(d, solved).state);
  const doneDays = states.filter((s) => s === 'done').length;
  const state: CompletionState =
    doneDays === totalDays
      ? 'done'
      : states.some((s) => s !== 'new')
        ? 'in-progress'
        : 'new';
  return { state, doneDays, totalDays };
}
