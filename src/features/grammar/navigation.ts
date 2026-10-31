import { create } from 'zustand';
import { subscribeDataScope } from '@/features/account/dataScope';

const defaults = { query: '', level: 'all', category: 'all', anchor: null };
export const useGrammarView = create<{
  query: string;
  level: string;
  category: string;
  anchor: { id: string; top: number } | null;
  update: (
    patch: Partial<{ query: string; level: string; category: string }>
  ) => void;
  reset: () => void;
}>((set) => ({
  ...defaults,
  update: (patch) => set(patch),
  reset: () => set(defaults),
}));
subscribeDataScope(() => useGrammarView.getState().reset());
