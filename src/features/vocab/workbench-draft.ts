import { create } from 'zustand';
import { captureDataScope, subscribeDataScope } from '@/features/account/dataScope';
import type { TextMode } from './text-workbench';

type Draft = { text: string; owned: () => boolean };
type WorkbenchDraft = {
  draft: Draft;
  mode: TextMode | null;
  setDraft: (draft: Draft) => void;
  setMode: (mode: TextMode, owned: () => boolean) => void;
};

// Navigation memory only: source text is not persisted or synchronized.
export const useWorkbenchDraft = create<WorkbenchDraft>(set => ({
  draft: { text: '', owned: captureDataScope() },
  mode: null,
  setDraft: draft => { if (draft.owned()) set({ draft }); },
  setMode: (mode, owned) => { if (owned()) set({ mode }); },
}));

subscribeDataScope(change => {
  const previous = useWorkbenchDraft.getState();
  useWorkbenchDraft.setState({
    draft: { text: change === 'adopt-anonymous' ? previous.draft.text : '', owned: captureDataScope() },
    mode: change === 'adopt-anonymous' ? previous.mode : null,
  });
});
