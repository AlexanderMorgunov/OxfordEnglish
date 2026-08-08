import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Button, Console, Input } from '@/shared/ui';
import { checkAnswer } from '../normalize';
import { useExerciseAttempt } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'translate' }>;
  onSolved?: () => void;
};

export function TranslateExercise({ exercise, onSolved }: Props) {
  const [value, setValue] = useState('');
  const { status, revealHint, submit } = useExerciseAttempt(exercise, onSolved);

  const check = () => {
    if (!value.trim() || status === 'correct') return;
    submit(checkAnswer(value, exercise.answers), value, {
      front: exercise.prompt,
      back: exercise.answers[0] ?? '',
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
              ? `✓ passed — e.g. "${exercise.answers[0]}"`
              : '✕ not a match yet — try again'}
          </Console>
        )
      }
    >
      <p className="mb-3.5 text-lg">
        {exercise.prompt}
        <span className="ml-2 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
          {exercise.direction}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="min-w-64 flex-1"
          placeholder="your translation…"
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
