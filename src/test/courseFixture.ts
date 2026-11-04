import type { LoadedPack, LoadedUnit } from '@/content/loader';
import type { Day, Level } from '@/content/schema';
import type { ExerciseAttempt } from '@/db/db';

export function courseDay(id: string, level: Level = 'A1', scored = true): Day {
  const title = { en: `Day ${id}`, ru: `День ${id}` };
  return {
    id,
    title,
    level,
    estimatedMinutes: 15,
    tags: [],
    sections: scored
      ? [
          {
            id: `${id}.practice`,
            type: 'practice',
            title,
            exercises: [1, 2].map((n) => ({
              id: `${id}.e${n}`,
              type: 'choice',
              instruction: { en: 'Choose' },
              tags: [],
              prompt: 'I … happy.',
              options: ['am', 'is'],
              correctIndex: 0,
            })),
          },
        ]
      : [
          {
            id: `${id}.vocab`,
            type: 'vocabulary',
            title,
            words: [{ word: 'hello', ru: 'привет' }],
          },
        ],
  };
}

export function courseUnit(id: string, days: Day[]): LoadedUnit {
  return {
    id,
    title: { en: `Topic ${id}`, ru: `Тема ${id}` },
    dayIds: days.map((day) => day.id),
    days,
  };
}

export function coursePack(
  units = [
    courseUnit('intro', [courseDay('a'), courseDay('b')]),
    courseUnit('next', [courseDay('c', 'A2')]),
  ]
): LoadedPack {
  const title = { en: 'Test course' };
  const license = { type: 'original' as const, attribution: 'Test fixture' };
  return {
    manifest: {
      id: 'test-course',
      name: title,
      level: 'A1',
      version: '1',
      visibility: 'public',
      license,
      attributions: [],
    },
    course: { id: 'course', title, level: 'A1', license, units },
    units,
    days: new Map(
      units.flatMap((unit) => unit.days.map((day) => [day.id, day] as const))
    ),
    grammar: [],
  };
}

export function courseAttempt(
  exerciseId: string,
  correct = true
): ExerciseAttempt {
  return {
    exerciseId,
    correct,
    tags: [],
    userAnswer: 'answer',
    attemptNumber: 1,
    timestamp: 100,
    usedAI: false,
    usedHint: false,
  };
}
