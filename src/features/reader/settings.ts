import { create } from 'zustand';

const KEY = 'oxford-reader-coloring';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

type ReaderSettings = {
  /** LingQ-style in-text word-status coloring in the book reader. */
  coloring: boolean;
  toggleColoring: () => void;
};

export const useReaderSettings = create<ReaderSettings>((set, get) => ({
  coloring: load(),
  toggleColoring: () => {
    const next = !get().coloring;
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // ignore storage failures
    }
    set({ coloring: next });
  },
}));
