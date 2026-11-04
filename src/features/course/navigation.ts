import { create } from 'zustand';
import { subscribeDataScope } from '@/features/account/dataScope';
import type { WorkingDay } from './model';

const KEY = 'oxford-course-work';
function loadWork(): WorkingDay | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'packId' in value &&
      'dayId' in value &&
      typeof value.packId === 'string' &&
      typeof value.dayId === 'string' &&
      value.packId &&
      value.dayId
    ) {
      return { packId: value.packId, dayId: value.dayId };
    }
  } catch {
    /* Storage may be unavailable. */
  }
  return null;
}
function persist(work: WorkingDay | null) {
  try {
    if (work) localStorage.setItem(KEY, JSON.stringify(work));
    else localStorage.removeItem(KEY);
  } catch {
    /* Navigation still works for the current session. */
  }
}

export type BrowsePosition = { scroll: number; focus: string | null };
type CourseNavigation = {
  work: WorkingDay | null;
  packId: string | null;
  viewedUnitId: string | null;
  selected: Record<string, string>;
  expanded: string[] | null;
  positions: Record<string, BrowsePosition>;
  prepare: (packId: string) => void;
  openDay: (packId: string, unitId: string, dayId: string) => void;
  viewUnit: (unitId: string) => void;
  selectDay: (unitId: string, dayId: string) => void;
  setExpanded: (levels: string[]) => void;
  remember: (key: string, position: BrowsePosition) => void;
  reset: () => void;
};
const browseDefaults = () => ({
  packId: null,
  viewedUnitId: null,
  selected: {},
  expanded: null,
  positions: {},
});

export const useCourseNavigation = create<CourseNavigation>((set, get) => ({
  ...browseDefaults(),
  work: loadWork(),
  prepare: (packId) => {
    if (get().packId !== packId) set({ ...browseDefaults(), packId });
  },
  openDay: (packId, unitId, dayId) => {
    get().prepare(packId);
    const current = get();
    if (
      current.work?.packId === packId &&
      current.work.dayId === dayId &&
      current.viewedUnitId === unitId &&
      current.selected[unitId] === dayId
    )
      return;
    const work = { packId, dayId };
    persist(work);
    set({
      work,
      viewedUnitId: unitId,
      selected: { ...get().selected, [unitId]: dayId },
    });
  },
  viewUnit: (viewedUnitId) => set({ viewedUnitId }),
  selectDay: (unitId, dayId) =>
    set((s) => ({ selected: { ...s.selected, [unitId]: dayId } })),
  setExpanded: (expanded) => set({ expanded }),
  remember: (key, position) =>
    set((s) => ({ positions: { ...s.positions, [key]: position } })),
  reset: () => {
    persist(null);
    set({ ...browseDefaults(), work: null });
  },
}));

subscribeDataScope((change) => {
  if (change === 'reset') useCourseNavigation.getState().reset();
});
