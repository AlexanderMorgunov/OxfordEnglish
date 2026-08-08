import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Button, Console, Option } from '@/shared/ui';
import { shuffle } from '../shuffle';
import { useExerciseAttempt } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'order-words' }>;
  onSolved?: () => void;
};

const arrayEq = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function OrderWordsExercise({ exercise, onSolved }: Props) {
  const [display] = useState(() => shuffle(exercise.tokens.map((_, i) => i)));
  const [picked, setPicked] = useState<number[]>([]);
  const { status, revealHint, submit } = useExerciseAttempt(exercise, onSolved);

  const pick = (i: number) => {
    if (status === 'correct' || picked.includes(i)) return;
    const next = [...picked, i];
    setPicked(next);
    if (next.length === exercise.tokens.length) {
      submit(
        arrayEq(next, exercise.correctOrder),
        next.map((k) => exercise.tokens[k]).join(' ')
      );
    }
  };

  const reset = () => {
    if (status === 'correct') return;
    setPicked([]);
  };

  return (
    <ExerciseShell
      instruction={exercise.instruction}
      hint={exercise.hint}
      explanation={exercise.explanation}
      status={status}
      onRevealHint={revealHint}
      feedback={
        status !== 'idle' && (
          <Console status={status === 'correct' ? 'pass' : 'fail'}>
            {status === 'correct'
              ? '✓ passed — correct order'
              : '✕ wrong order — reset and try again'}
          </Console>
        )
      }
    >
      <div className="mb-3.5 min-h-11 rounded-sm border border-line bg-ink px-3 py-2.5 font-mono text-base">
        {picked.length === 0 ? (
          <span className="text-faint">tap the words in order…</span>
        ) : (
          picked.map((k) => exercise.tokens[k]).join(' ')
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {display.map((i) => (
          <Option
            key={i}
            disabled={picked.includes(i) || status === 'correct'}
            className={picked.includes(i) ? 'opacity-40' : undefined}
            onClick={() => pick(i)}
          >
            {exercise.tokens[i]}
          </Option>
        ))}
      </div>
      {picked.length > 0 && status !== 'correct' && (
        <Button variant="ghost" size="sm" onClick={reset}>
          Reset
        </Button>
      )}
    </ExerciseShell>
  );
}
