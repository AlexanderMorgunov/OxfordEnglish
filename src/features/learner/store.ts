import { create } from 'zustand';
import type { Level } from '@/content/schema';
import { track } from '@/features/analytics/analytics';
import { stampSetting } from '@/features/sync/local';
import { registerSettingBridge } from '@/features/sync/settingsBridge';

const KEY = 'oxford-learner';
const SETTING_KEY = 'learner';

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

function persist(state: LearnerState, sync = true) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
  if (sync) void stampSetting(SETTING_KEY, state);
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
      persist(EMPTY, false); // device-local only — never sync a wipe (would clobber the level on other devices)
      return EMPTY;
    }),
}));

/** Apply a learner state synced from another device. `placementDone` is monotonic — a stale `false`
 *  never re-shows the placement flow to someone who already finished it. Persists without re-stamping. */
export function applyLearnerFromSync(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<LearnerState>;
  useLearner.setState((s) => {
    const next: LearnerState = {
      level: (v.level ?? s.level) as Level | null,
      recommendedUnitId: v.recommendedUnitId ?? s.recommendedUnitId,
      placementDone: !!v.placementDone || s.placementDone,
    };
    persist(next, false);
    return next;
  });
}

registerSettingBridge({ key: SETTING_KEY, applyFromSync: applyLearnerFromSync });
