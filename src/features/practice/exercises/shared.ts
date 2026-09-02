import { useEffect, useState } from 'react';
import { addAttempt } from '@/features/sync/local';
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

export const AI_HINT_LIMIT = 5;

const outcomeOf = (r: { solved: boolean } | undefined): ExerciseStatus =>
  r ? (r.solved ? 'correct' : 'incorrect') : 'idle';

export function useExerciseAttempt(exercise: ExerciseMeta, onSolved?: () => void) {
  // Restore a prior outcome from the session results (which outlive an in-app remount, e.g. a trip
  // to Settings and back) so the day's progress isn't visually reset. `stored` is a live slice, so
  // a late IndexedDB hydrate after mount restores too.
  const stored = useSessionResults((s) => s.results[exercise.id]);
  const [status, setStatus] = useState<ExerciseStatus>(() => outcomeOf(stored));
  const [attemptNumber, setAttemptNumber] = useState(() => stored?.attempts ?? 0);
  const [attempts, setAttempts] = useState<string[]>([]);
  const [usedHint, setUsedHint] = useState(false);
  const [aiHintsUsed, setAiHintsUsed] = useState(0);

  useEffect(() => {
    if (!stored) return;
    setStatus((cur) => (cur === 'idle' ? outcomeOf(stored) : cur));
    setAttemptNumber((cur) => (cur === 0 ? stored.attempts : cur));
  }, [stored]);

  const submit = (
    correct: boolean,
    userAnswer: string,
    errorCard?: { front: string; back: string }
  ) => {
    if (status === 'correct') return;
    const n = attemptNumber + 1;
    setAttemptNumber(n);
    setAttempts((prev) => [...prev, userAnswer]);
    useSessionResults.getState().record(exercise.id, correct, exercise.tags);
    void addAttempt({
      exerciseId: exercise.id,
      tags: exercise.tags,
      correct,
      userAnswer,
      attemptNumber: n,
      timestamp: Date.now(),
      usedHint,
      usedAI: false,
    }).catch(() => undefined);
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
    attempts,
    usedHint,
    aiHintsUsed,
    aiHintsLeft: AI_HINT_LIMIT - aiHintsUsed,
    noteAiHint: () => setAiHintsUsed((n) => n + 1),
    canReveal: attemptNumber >= 2 && status !== 'correct',
    revealHint: () => setUsedHint(true),
    submit,
  };
}

export type ExerciseAttempt = ReturnType<typeof useExerciseAttempt>;
