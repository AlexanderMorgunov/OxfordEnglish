import { create } from 'zustand';
import { loadPublicPack, type LoadedPack } from './loader';

type ContentState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  pack: LoadedPack | null;
  error: string | null;
  load: () => Promise<void>;
};

export const useContentStore = create<ContentState>((set, get) => ({
  status: 'idle',
  pack: null,
  error: null,
  load: async () => {
    const { status } = get();
    if (status === 'loading' || status === 'ready') return;
    set({ status: 'loading', error: null });
    try {
      const pack = await loadPublicPack();
      set({ status: 'ready', pack });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
