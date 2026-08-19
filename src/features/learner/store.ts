import { create } from 'zustand';
import type { Level } from '@/content/schema';
import { track } from '@/features/analytics/analytics';

const KEY = 'oxford-learner';

export type LearnerState = {
  level: Level | null;
  recommendedUnitId: string | null;
  placementDone: boolean;
};

const EMPTY: LearnerState = { level: null, recommendedUnitId: null, placementDone: false };

function load(): LearnerState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as LearnerState) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function persist(state: LearnerState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

type LearnerStore = LearnerState & {
  setPlacement: (level: Level, recommendedUnitId: string) => void;
  setLevel: (level: Level, recommendedUnitId: string) => void;
  reset: () => void;
};

export const useLearner = create<LearnerStore>((set) => ({
  ...load(),
  setPlacement: (level, recommendedUnitId) =>
    set(() => {
      const next: LearnerState = { level, recommendedUnitId, placementDone: true };
      persist(next);
      void track('placement_done', { level });
      return next;
    }),
  setLevel: (level, recommendedUnitId) =>
    set((s) => {
      const next: LearnerState = { ...s, level, recommendedUnitId };
      persist(next);
      return next;
    }),
  reset: () =>
    set(() => {
      persist(EMPTY);
      return EMPTY;
    }),
}));
