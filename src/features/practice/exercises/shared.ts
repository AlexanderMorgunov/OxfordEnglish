import { use } from 'react';
import { useStore } from 'zustand';
import { addAttempt } from '@/features/sync/local';
import type { LocalizedText } from '@/content/schema';
import { ExerciseSessionContext } from './session';
import { track } from '@/features/analytics/analytics';
import { captureDataScope, getDataOwnerRevision } from '@/features/account/dataScope';
import { useExerciseState } from './useExerciseState';

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
  const stored = useStore(results, s => s.scopeRevision === getDataOwnerRevision() ? s.results[exercise.id] : undefined);
  const status = outcomeOf(stored);
  const attemptNumber = stored?.attempts ?? 0;
  const [attempts, setAttempts] = useExerciseState(exercise.id, 'attempts', []);
  const [usedHint, setUsedHint] = useExerciseState(exercise.id, 'usedHint', false);
  const [aiHintsUsed, setAiHintsUsed] = useExerciseState(exercise.id, 'aiHintsUsed', 0);

  const submit = (correct: boolean, userAnswer: string) => {
    if (!owned() || status === 'correct') return;
    results.getState().syncScope();
    if (owned() && !results.getState().results[exercise.id]) void track('practice_answered');
    const n = attemptNumber + 1;
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
      onSolved?.();
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
