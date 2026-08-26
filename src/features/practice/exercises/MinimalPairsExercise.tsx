import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { playClip } from '@/shared/lib/audio';
import { Button, Console, Option } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
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
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [chosen, setChosen] = useState<number | null>(null);
  const attempt = useExerciseAttempt(exercise, onSolved);
  const { status, submit } = attempt;

  const pick = (i: number) => {
    if (status === 'correct') return;
    setChosen(i);
    submit(i === exercise.correctIndex, exercise.options[i] ?? '');
  };

  return (
    <ExerciseShell
      exercise={exercise}
      attempt={attempt}
      feedback={
        status !== 'idle' && (
          <Console status={status === 'correct' ? 'pass' : 'fail'}>
            {status === 'correct'
              ? `✓ верно — "${exercise.options[exercise.correctIndex]}"`
              : ru
                ? '✕ послушайте ещё раз'
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
        {ru ? '▶ слушать' : '▶ listen'}
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
