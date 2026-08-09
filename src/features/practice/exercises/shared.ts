import { useState } from 'react';
import { recordAttempt } from '@/db/db';
import { addErrorCard } from '@/features/srs/service';
import { useSessionResults } from '@/features/progress/sessionResults';
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

  const submit = (
    correct: boolean,
    userAnswer: string,
    errorCard?: { front: string; back: string }
  ) => {
    if (status === 'correct') return;
    const n = attemptNumber + 1;
    setAttemptNumber(n);
    useSessionResults.getState().record(exercise.id, correct, exercise.tags);
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
      if (errorCard) {
        void addErrorCard(exercise.id, errorCard.front, errorCard.back, exercise.tags);
      }
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
