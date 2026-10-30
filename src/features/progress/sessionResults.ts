import { create } from 'zustand';
import { getDataOwnerRevision, subscribeDataScope } from '@/features/account/dataScope';

export type ExerciseDraft = {
  answer: string;
  chosen: number | null;
  order: number[];
  picked: number[];
  pairs: Record<number, number>;
  selectedLeft: number | null;
  attempts: string[];
  usedHint: boolean;
  aiHintsUsed: number;
  showHint: boolean;
  showAnswer: boolean;
};

export type ExerciseResult = {
  firstCorrect: boolean;
  attempts: number;
  tags: string[];
  /** Eventually answered correctly — lets an exercise restore its solved state after a remount
   *  (e.g. returning from Settings), so the day's progress isn't visually lost. */
  solved: boolean;
};

type SessionResultsState = {
  scopeRevision: number;
  syncScope: () => void;
  results: Record<string, ExerciseResult>;
  drafts: Record<string, Partial<ExerciseDraft>>;
  setDraft: <K extends keyof ExerciseDraft>(id: string, key: K, value: ExerciseDraft[K]) => void;
  record: (id: string, correct: boolean, tags: string[]) => void;
  hydrate: (entries: { id: string; result: ExerciseResult }[]) => void;
  reset: (ids: string[]) => void;
};

/**
 * Live per-exercise outcomes for the current run, so the day summary can react
 * as answers land. `firstCorrect` is fixed by the first attempt (the honest
 * "did you know it" signal); later attempts only bump the count.
 */
export const createSessionResults = () => create<SessionResultsState>((set) => ({
  scopeRevision: getDataOwnerRevision(),
  syncScope: () => set(state => state.scopeRevision === getDataOwnerRevision() ? state
    : { scopeRevision: getDataOwnerRevision(), results: {}, drafts: {} }),
  results: {},
  drafts: {},
  setDraft: (id, key, value) => set(state => ({
    drafts: { ...state.drafts, [id]: { ...state.drafts[id], [key]: value } },
  })),
  record: (id, correct, tags) =>
    set((state) => {
      const prev = state.results[id];
      if (prev) {
        return {
          results: {
            ...state.results,
            [id]: { ...prev, attempts: prev.attempts + 1, solved: prev.solved || correct },
          },
        };
      }
      return {
        results: {
          ...state.results,
          [id]: { firstCorrect: correct, attempts: 1, tags, solved: correct },
        },
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
      const drafts = { ...state.drafts };
      for (const id of ids) { delete next[id]; delete drafts[id]; }
      return { results: next, drafts };
    }),
}));

export const useSessionResults = createSessionResults();

subscribeDataScope(change => {
  useSessionResults.setState(change === 'adopt-anonymous'
    ? { scopeRevision: getDataOwnerRevision() }
    : { scopeRevision: getDataOwnerRevision(), results: {}, drafts: {} });
});
