import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Button, Console, Input } from '@/shared/ui';
import { checkAnswer } from '../normalize';
import { useExerciseAttempt } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'gap-fill' }>;
  onSolved?: () => void;
};

export function GapFillExercise({ exercise, onSolved }: Props) {
  const [value, setValue] = useState('');
  const { status, revealHint, submit } = useExerciseAttempt(exercise, onSolved);
  const [before, after] = exercise.prompt.split(/_{2,}/);

  const check = () => {
    if (!value.trim() || status === 'correct') return;
    submit(
      checkAnswer(value, exercise.answers, {
        caseSensitive: exercise.caseSensitive,
      }),
      value,
      { front: exercise.prompt, back: exercise.answers[0] ?? '' }
    );
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
              ? '✓ test passed'
              : '✕ assertion failed — try again'}
          </Console>
        )
      }
    >
      <p className="mb-3.5 font-mono text-base">
        {before}
        <span className="text-teal">
          {status === 'correct' ? exercise.answers[0] : '____'}
        </span>
        {after}
        {exercise.cue && <span className="ml-2 text-amber">{exercise.cue}</span>}
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="w-48"
          placeholder="past form…"
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
