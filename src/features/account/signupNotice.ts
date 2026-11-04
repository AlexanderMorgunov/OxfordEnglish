import { create } from 'zustand';
import { captureAccountSessionOwner } from './store';
import type { Entitlement } from './contract';

export const useSignupNotice = create<{
  notice: { plan: Entitlement; owned: () => boolean } | null;
  show: (plan: Entitlement) => void;
  close: () => void;
}>((set) => ({
  notice: null,
  show: (plan) =>
    set({ notice: { plan, owned: captureAccountSessionOwner() } }),
  close: () => set({ notice: null }),
}));
export const showAccountAccessNotice = (plan: Entitlement) =>
  useSignupNotice.getState().show(plan);
