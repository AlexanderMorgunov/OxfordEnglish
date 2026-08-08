import { useState } from 'react';
import { recordAttempt } from '@/db/db';
import type { LocalizedText } from '@/content/schema';

export type ExerciseStatus = 'idle' | 'correct' | 'incorrect';

export type ExerciseMeta = {
  id: string;
  tags: string[];
  hint?: LocalizedText;
  explanation?: LocalizedText;
};

export function useExerciseAttempt(exercise: ExerciseMeta, onSolved?: () => void) {
  const [status, setStatus] = useState<ExerciseStatus>('idle');
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [usedHint, setUsedHint] = useState(false);

  const submit = (correct: boolean, userAnswer: string) => {
    if (status === 'correct') return;
    const n = attemptNumber + 1;
    setAttemptNumber(n);
    void recordAttempt({
      exerciseId: exercise.id,
      tags: exercise.tags,
      correct,
      userAnswer,
      attemptNumber: n,
      timestamp: Date.now(),
      usedHint,
      usedAI: false,
    });
    if (correct) {
      setStatus('correct');
      onSolved?.();
    } else {
      setStatus('incorrect');
    }
  };

  return {
    status,
    attemptNumber,
    usedHint,
    revealHint: () => setUsedHint(true),
    submit,
  };
}
