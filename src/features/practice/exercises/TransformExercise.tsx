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
      aiContext={{
        prompt: exercise.prompt,
        userAnswer: value,
        correct: exercise.answers[0] ?? '',
        topic: exercise.tags[0] ?? 'grammar',
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
      <p className="mb-3.5 font-mono text-base text-muted">{exercise.prompt}</p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="min-w-64 flex-1"
          placeholder="rewrite…"
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
