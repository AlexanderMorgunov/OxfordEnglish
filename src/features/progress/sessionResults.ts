import { create } from 'zustand';

export type ExerciseResult = {
  firstCorrect: boolean;
  attempts: number;
  tags: string[];
};

type SessionResultsState = {
  results: Record<string, ExerciseResult>;
  record: (id: string, correct: boolean, tags: string[]) => void;
  hydrate: (entries: { id: string; result: ExerciseResult }[]) => void;
  reset: (ids: string[]) => void;
};

/**
 * Live per-exercise outcomes for the current run, so the day summary can react
 * as answers land. `firstCorrect` is fixed by the first attempt (the honest
 * "did you know it" signal); later attempts only bump the count.
 */
export const useSessionResults = create<SessionResultsState>((set) => ({
  results: {},
  record: (id, correct, tags) =>
    set((state) => {
      const prev = state.results[id];
      if (prev) {
        return {
          results: { ...state.results, [id]: { ...prev, attempts: prev.attempts + 1 } },
        };
      }
      return {
        results: { ...state.results, [id]: { firstCorrect: correct, attempts: 1, tags } },
      };
    }),
  hydrate: (entries) =>
    set((state) => {
      const next = { ...state.results };
      for (const { id, result } of entries) if (!next[id]) next[id] = result;
      return { results: next };
    }),
  reset: (ids) =>
    set((state) => {
      const next = { ...state.results };
      for (const id of ids) delete next[id];
      return { results: next };
    }),
}));
