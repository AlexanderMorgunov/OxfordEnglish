import type { ExerciseAttempt } from '@/db/db';
import type { Day, LocalizedText } from '@/content/schema';
import type { LoadedUnit } from '@/content/loader';
import type { ExerciseResult } from './sessionResults';

export type DayExercise = { id: string; tags: string[]; instruction: LocalizedText };

/** Practice + listening exercises, in the order they appear in the day. */
export function dayExercises(day: Day): DayExercise[] {
  const out: DayExercise[] = [];
  for (const section of day.sections) {
    if (section.type === 'practice' || section.type === 'listening') {
      for (const e of section.exercises) out.push({ id: e.id, tags: e.tags, instruction: e.instruction });
    }
  }
  return out;
}

/** Per-exercise outcome from stored attempts — first attempt fixes correctness. */
export function resultsFromAttempts(
  attempts: ExerciseAttempt[]
): { id: string; result: ExerciseResult }[] {
  const byId = new Map<string, ExerciseAttempt[]>();
  for (const a of attempts) {
    const list = byId.get(a.exerciseId) ?? [];
    list.push(a);
    byId.set(a.exerciseId, list);
  }
  return [...byId.entries()].map(([id, list]) => {
    const sorted = [...list].sort((a, b) => a.attemptNumber - b.attemptNumber);
    return {
      id,
      result: {
        firstCorrect: sorted[0]?.correct ?? false,
        attempts: list.length,
        tags: sorted[0]?.tags ?? [],
      },
    };
  });
}

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
