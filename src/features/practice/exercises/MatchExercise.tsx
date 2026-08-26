import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Button, Console, Option } from '@/shared/ui';
import { shuffle } from '../shuffle';
import { useUiLang } from '@/features/i18n/uiLang';
import { exLabels } from '@/features/i18n/ui-strings';
import { useExerciseAttempt } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'match' }>;
  onSolved?: () => void;
};

export function MatchExercise({ exercise, onSolved }: Props) {
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const [rightOrder] = useState(() => shuffle(exercise.pairs.map((_, i) => i)));
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [assign, setAssign] = useState<Record<number, number>>({});
  const attempt = useExerciseAttempt(exercise, onSolved);
  const { status, submit } = attempt;

  const usedRight = new Set(Object.values(assign));

  const assignRight = (rightIdx: number) => {
    if (status === 'correct' || selectedLeft === null || usedRight.has(rightIdx))
      return;
    const next = { ...assign, [selectedLeft]: rightIdx };
    setSelectedLeft(null);
    setAssign(next);
    if (Object.keys(next).length === exercise.pairs.length) {
      const allCorrect = exercise.pairs.every((_, i) => next[i] === i);
      submit(
        allCorrect,
        exercise.pairs
          .map((p, i) => `${p.left}=${exercise.pairs[next[i]!]?.right}`)
          .join(', ')
      );
    }
  };

  const reset = () => {
    if (status === 'correct') return;
    setAssign({});
    setSelectedLeft(null);
  };

  return (
    <ExerciseShell
      exercise={exercise}
      attempt={attempt}
      feedback={
        status !== 'idle' && (
          <Console status={status === 'correct' ? 'pass' : 'fail'}>
            {status === 'correct'
              ? ru
                ? '✓ верно — все пары совпали'
                : '✓ passed — all pairs matched'
              : ru
                ? '✕ некоторые пары неверны — сброс и ещё раз'
                : '✕ some pairs are off — reset and try again'}
          </Console>
        )
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          {exercise.pairs.map((pair, i) => (
            <Option
              key={pair.left}
              state={selectedLeft === i ? 'chosen' : 'default'}
              disabled={status === 'correct'}
              onClick={() => setSelectedLeft(i)}
            >
              {pair.left}
              {assign[i] !== undefined && (
                <span className="ml-2 text-teal">
                  → {exercise.pairs[assign[i]!]?.right}
                </span>
              )}
            </Option>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {rightOrder.map((rightIdx) => (
            <Option
              key={exercise.pairs[rightIdx]?.right}
              disabled={usedRight.has(rightIdx) || status === 'correct'}
              className={usedRight.has(rightIdx) ? 'opacity-40' : undefined}
              onClick={() => assignRight(rightIdx)}
            >
              {exercise.pairs[rightIdx]?.right}
            </Option>
          ))}
        </div>
      </div>
      {Object.keys(assign).length > 0 && status !== 'correct' && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={reset}>
          {exLabels(lang).reset}
        </Button>
      )}
    </ExerciseShell>
  );
}
