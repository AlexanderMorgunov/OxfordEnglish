import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Button, Console, Input } from '@/shared/ui';
import { checkAnswer } from '../normalize';
import { useExerciseAttempt } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'transform' }>;
  onSolved?: () => void;
};

export function TransformExercise({ exercise, onSolved }: Props) {
  const [value, setValue] = useState('');
  const attempt = useExerciseAttempt(exercise, onSolved);
  const { status, submit } = attempt;

  const check = () => {
    if (!value.trim() || status === 'correct') return;
    submit(checkAnswer(value, exercise.answers), value, {
      front: exercise.prompt,
      back: exercise.answers[0] ?? '',
    });
  };

  return (
    <ExerciseShell
      exercise={exercise}
      attempt={attempt}
      ai={{
        prompt: exercise.prompt,
        userAnswer: value,
        correct: exercise.answers[0] ?? '',
      }}
      feedback={
        status !== 'idle' && (
          <Console status={status === 'correct' ? 'pass' : 'fail'}>
            {status === 'correct'
              ? `✓ passed — "${exercise.answers[0]}"`
              : '✕ not quite — rewrite it and try again'}
          </Console>
        )
      }
    >
      <p className="mb-3.5 font-mono text-base">
        <span className="text-muted">{exercise.prompt}</span>
        <span className="ml-2 text-faint">→ ?</span>
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="min-w-64 flex-1"
          placeholder="rewrite the sentence…"
          value={value}
          disabled={status === 'correct'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && check()}
        />
        <Button onClick={check} disabled={status === 'correct'}>
          Run check
        </Button>
      </div>
    </ExerciseShell>
  );
}
