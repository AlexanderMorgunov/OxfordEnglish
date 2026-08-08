import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { Button, Console, Input } from '@/shared/ui';
import { checkAnswer } from '../normalize';
import { useExerciseAttempt } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'dictation' }>;
  onSolved?: () => void;
};

export function DictationExercise({ exercise, onSolved }: Props) {
  const [value, setValue] = useState('');
  const { status, revealHint, submit } = useExerciseAttempt(exercise, onSolved);

  const check = () => {
    if (!value.trim() || status === 'correct') return;
    submit(checkAnswer(value, [exercise.answer]), value);
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
              ? `✓ passed — "${exercise.answer}"`
              : '✕ not quite — listen again and retype'}
          </Console>
        )
      }
    >
      <audio
        controls
        preload="none"
        src={packMediaUrl(exercise.audio.src)}
        className="mb-3.5 w-full"
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="min-w-64 flex-1"
          placeholder="type what you hear…"
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
