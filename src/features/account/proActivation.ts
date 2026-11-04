import { create } from 'zustand';
import { subscribeDataScope } from './dataScope';

export type ProTask = { source: 'lesson' | 'reader' | 'text' | 'pro'; excerpt?: string; answer?: string };
type ActivationBase = { task: ProTask; pathname: string; trigger: HTMLElement | null; fallback: HTMLElement | null };
export type ReaderWordActivation = ActivationBase & { kind: 'reader-word'; word: string; returnId: string; intent: 'trial' | 'purchase' };
type Activation = (ActivationBase & { kind?: 'generic' }) | ReaderWordActivation;

export const useProActivation = create<{
  entry: Activation | null;
  open: (task: ProTask, pathname: string, trigger?: HTMLElement | null) => void;
  openReaderWord: (entry: ReaderWordActivation) => void;
  close: () => void;
}>(set => ({
  entry: null,
  open: (task, pathname, trigger = null) => set({ entry: {
    task: { ...task, excerpt: task.excerpt?.slice(0, 420), answer: task.answer?.slice(0, 180) },
    pathname, trigger, fallback: trigger?.closest<HTMLElement>('[role="group"], main') ?? null,
  } }),
  close: () => set({ entry: null }),
  openReaderWord: entry => set({ entry }),
}));

subscribeDataScope(change => {
  if (change === 'adopt-anonymous') return;
  const entry = useProActivation.getState().entry;
  if (entry?.kind === 'reader-word') { useProActivation.setState({ entry: null }); return; }
  if (entry) useProActivation.setState({ entry: { ...entry, task: { source: 'pro' }, trigger: null } });
});
