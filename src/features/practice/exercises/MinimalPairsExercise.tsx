import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { playClip } from '@/shared/lib/audio';
import { Button, Console, Option } from '@/shared/ui';
import { useExerciseAttempt, type ExerciseStatus } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'minimal-pairs' }>;
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

export function MinimalPairsExercise({ exercise, onSolved }: Props) {
  const [chosen, setChosen] = useState<number | null>(null);
  const { status, revealHint, submit } = useExerciseAttempt(exercise, onSolved);

  const pick = (i: number) => {
    if (status === 'correct') return;
    setChosen(i);
    submit(i === exercise.correctIndex, exercise.options[i] ?? '');
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
              ? `✓ passed — "${exercise.options[exercise.correctIndex]}"`
              : '✕ listen again'}
          </Console>
        )
      }
    >
      <Button
        variant="ghost"
        className="mb-3.5"
        onClick={() => playClip(packMediaUrl(exercise.audio.src))}
      >
        ▶ listen
      </Button>
      <div className="flex flex-wrap gap-2">
        {exercise.options.map((opt, i) => (
          <Option
            key={opt}
            disabled={status === 'correct'}
            state={optionState(i, chosen, exercise.correctIndex, status)}
            onClick={() => pick(i)}
          >
            {opt}
          </Option>
        ))}
      </div>
    </ExerciseShell>
  );
}
