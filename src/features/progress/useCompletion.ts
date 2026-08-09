import { useEffect, useState } from 'react';
import { loadAttempts } from './queries';
import { solvedExerciseIds } from './completion';

/** Set of exercise ids with at least one correct attempt — the "done" signal. */
export function useSolvedExercises(): Set<string> {
  const [solved, setSolved] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let alive = true;
    void loadAttempts().then((attempts) => {
      if (alive) setSolved(solvedExerciseIds(attempts));
    });
    return () => {
      alive = false;
    };
  }, []);
  return solved;
}
