import { create } from 'zustand';
import { subscribeDataScope } from '@/features/account/dataScope';

export type LibraryFilter = {
  query: string;
  filter: string;
  sort: string;
  local: boolean;
};
export type LibraryTab = 'own' | 'catalog';
const defaults = (tab: LibraryTab): LibraryFilter => ({
  query: '',
  filter: 'all',
  sort: tab === 'own' ? 'recent' : 'level',
  local: false,
});
export const useLibraryView = create<{
  own: LibraryFilter;
  catalog: LibraryFilter;
  anchor: { id: string; top: number; path: string } | null;
  update: (tab: LibraryTab, patch: Partial<LibraryFilter>) => void;
  reset: (tab: LibraryTab) => void;
}>((set) => ({
  own: defaults('own'),
  catalog: defaults('catalog'),
  anchor: null,
  update: (tab, patch) =>
    set((state) => ({ [tab]: { ...state[tab], ...patch } })),
  reset: (tab) => set({ [tab]: defaults(tab) }),
}));
subscribeDataScope(() =>
  useLibraryView.setState({
    own: defaults('own'),
    catalog: defaults('catalog'),
    anchor: null,
  })
);
