import { create } from 'zustand';
import type { TourDefinition } from './content';

export const useOnboarding = create<{
  context: TourDefinition | null;
  ready: boolean;
  start: ((trigger: HTMLElement) => void) | null;
}>(() => ({ context: null, ready: false, start: null }));
