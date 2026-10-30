import { create } from 'zustand';
import { subscribeDataScope } from './dataScope';

export type ProTask = { source: 'lesson' | 'reader' | 'text' | 'pro'; excerpt?: string; answer?: string };
type Activation = { task: ProTask; pathname: string; trigger: HTMLElement | null; fallback: HTMLElement | null };

export const useProActivation = create<{
  entry: Activation | null;
  open: (task: ProTask, pathname: string, trigger?: HTMLElement | null) => void;
  close: () => void;
}>(set => ({
  entry: null,
  open: (task, pathname, trigger = null) => set({ entry: {
    task: { ...task, excerpt: task.excerpt?.slice(0, 420), answer: task.answer?.slice(0, 180) },
    pathname, trigger, fallback: trigger?.closest<HTMLElement>('[role="group"], main') ?? null,
  } }),
  close: () => set({ entry: null }),
}));

subscribeDataScope(change => {
  if (change === 'adopt-anonymous') return;
  const entry = useProActivation.getState().entry;
  if (entry) useProActivation.setState({ entry: { ...entry, task: { source: 'pro' }, trigger: null } });
});
