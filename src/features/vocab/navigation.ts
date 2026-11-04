import { create } from 'zustand';
import { subscribeDataScope } from '@/features/account/dataScope';
import type { LexiconFilter, LexiconSort } from './lexicon';

type VocabularyView = {
  query: string;
  filter: LexiconFilter;
  sort: LexiconSort;
  limit: number;
  anchor: { key: string; y: number } | null;
};
const initial: VocabularyView = {
  query: '',
  filter: 'all',
  sort: 'recent',
  limit: 8,
  anchor: null,
};
export const useVocabularyView = create<
  VocabularyView & {
    update: (patch: Partial<VocabularyView>) => void;
    reset: () => void;
  }
>((set) => ({
  ...initial,
  update: (patch) => set(patch),
  reset: () => set(initial),
}));
subscribeDataScope(() => useVocabularyView.getState().reset());
let routeSalt: string | null = null;
function salt() {
  if (routeSalt) return routeSalt;
  try {
    routeSalt = localStorage.getItem('oxford-vocabulary-route-salt');
    if (!routeSalt) {
      routeSalt = crypto.randomUUID();
      localStorage.setItem('oxford-vocabulary-route-salt', routeSalt);
    }
  } catch {
    routeSalt ??= `${Date.now()}:${Math.random()}`;
  }
  return routeSalt;
}
// Opaque device-local URLs keep saved terms out of page URLs. These are not access tokens.
export function vocabularyEntryId(key: string): string {
  let hash = 14695981039346656037n;
  for (const character of `${salt()}:${key}`)
    hash = BigInt.asUintN(
      64,
      (hash ^ BigInt(character.codePointAt(0)!)) * 1099511628211n
    );
  return hash.toString(16).padStart(16, '0');
}
export const vocabularyEntryPath = (key: string) =>
  `/vocabulary/entry/${vocabularyEntryId(key)}`;
