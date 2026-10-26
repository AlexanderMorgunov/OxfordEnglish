import { use, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { addAttempt } from '@/features/sync/local';
import type { LocalizedText } from '@/content/schema';
import { ExerciseSessionContext } from './session';
import { track } from '@/features/analytics/analytics';
import { captureDataScope } from '@/features/account/dataScope';

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
  const owned = captureDataScope();
  // Restore a prior outcome from the session results (which outlive an in-app remount, e.g. a trip
  // to Settings and back) so the day's progress isn't visually reset. `stored` is a live slice, so
  // a late IndexedDB hydrate after mount restores too.
  const results = use(ExerciseSessionContext);
  const stored = useStore(results, (s) => s.results[exercise.id]);
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

  const submit = (correct: boolean, userAnswer: string) => {
    if (status === 'correct') return;
    if (owned() && !results.getState().results[exercise.id]) void track('practice_answered');
    const n = attemptNumber + 1;
    setAttemptNumber(n);
    setAttempts((prev) => [...prev, userAnswer]);
    results.getState().record(exercise.id, correct, exercise.tags);
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
      // A wrong answer used to create a review card here. It no longer does: the review queue is what
      // the learner chose to keep, and a gap-fill prompt torn out of its exercise ("Give it to ___ .")
      // cannot be answered there anyway. The attempt is still recorded above, which is where every
      // statistic about mistakes already comes from.
      setStatus('incorrect');
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
