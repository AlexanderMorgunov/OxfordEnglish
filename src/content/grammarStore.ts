import { create } from 'zustand';
import { loadGrammarOnly } from './loader';
import type { GrammarArticle } from './schema';

/**
 * The grammar reference, loaded on its own rather than as a slice of the whole pack.
 *
 * `useContentStore` is the right store for anything inside a learning day, but /grammar and the 48
 * /grammar/<id> pages are public, indexable pages that must render for a visitor who has never opened
 * the course — and for a crawler that is allowed exactly one pack file. Depending on the full pack made
 * them fail together with any one of its 213 days.
 *
 * `error` is deliberately distinct from a ready-but-empty list: collapsing the two is what let a failed
 * load render as "article not found", which is the answer to a different question.
 */
type GrammarState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  articles: GrammarArticle[];
  load: () => Promise<void>;
};

export const useGrammarStore = create<GrammarState>((set, get) => ({
  status: 'idle',
  articles: [],
  load: async () => {
    const { status } = get();
    if (status === 'loading' || status === 'ready') return;
    set({ status: 'loading' });
    try {
      set({ status: 'ready', articles: await loadGrammarOnly() });
    } catch {
      set({ status: 'error', articles: [] });
    }
  },
}));
