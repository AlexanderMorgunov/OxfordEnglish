import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Console, Option } from '@/shared/ui';
import { useExerciseAttempt, type ExerciseStatus } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'spot-error' }>;
  onSolved?: () => void;
};

function optionState(
  i: number,
  chosen: number | null,
  correctIndex: number,
  status: ExerciseStatus
) {
  if (status === 'correct' && i === correctIndex) return 'correct' as const;
  if (i === chosen && i !== correctIndex) return 'wrong' as const;
  return 'default' as const;
}

export function SpotErrorExercise({ exercise, onSolved }: Props) {
  const [chosen, setChosen] = useState<number | null>(null);
  const { status, revealHint, submit } = useExerciseAttempt(exercise, onSolved);

  const pick = (i: number) => {
    if (status === 'correct') return;
    setChosen(i);
    submit(i === exercise.correctIndex, exercise.variants[i] ?? '', {
      front: exercise.instruction.en,
      back: exercise.variants[exercise.correctIndex] ?? '',
    });
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
              ? '✓ passed — clean syntax'
              : '✕ syntax error — check the verb form, then pick the other line'}
          </Console>
        )
      }
    >
      <div
        className="flex flex-col gap-2"
        onKeyDown={(e) => {
          const n = Number(e.key);
          if (n >= 1 && n <= exercise.variants.length) pick(n - 1);
        }}
      >
        {exercise.variants.map((variant, i) => (
          <Option
            key={variant}
            disabled={status === 'correct'}
            state={optionState(i, chosen, exercise.correctIndex, status)}
            onClick={() => pick(i)}
          >
            <span className="text-faint">{i + 1}.</span> {variant}
          </Option>
        ))}
      </div>
    </ExerciseShell>
  );
}
