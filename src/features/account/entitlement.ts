import { create } from 'zustand';
import { useAccount } from './store';
import { getInstallId } from '@/features/sync/meta';
import * as api from './api';
import { ApiFailure } from './api';
import type { Entitlement } from './contract';

/**
 * Client-side view of the account's plan and AI quota. Server truth, so it is fetched rather than
 * persisted — a stale cached "pro" would let the UI promise a feature the server then refuses, which
 * reads as a bug rather than as an expired subscription.
 *
 * Deliberately not gating anything offline: `hasManagedAi()` is false when we have no fresh answer, and
 * the BYOK path (and the free translator) stay available either way — accounts are additive, never a
 * precondition for the app working.
 */
type EntitlementState = {
  entitlement: Entitlement | null;
  loading: boolean;
  /** Last error code from a claim attempt, for the UI to explain (e.g. `trial_already_claimed`). */
  error: string | null;
  load: () => Promise<void>;
  claimTrial: () => Promise<boolean>;
  clear: () => void;
  /** Apply the quota figures the AI proxy returns, so the counter moves without an extra round-trip. */
  applyUsage: (ai: Entitlement['ai']) => void;
};

export const useEntitlement = create<EntitlementState>((set, get) => ({
  entitlement: null,
  loading: false,
  error: null,

  load: async () => {
    const token = await useAccount.getState().getAccessToken();
    if (!token) {
      set({ entitlement: null });
      return;
    }
    set({ loading: true });
    try {
      set({ entitlement: await api.getEntitlement(token), error: null });
    } catch {
      // Offline or a server hiccup: keep whatever we had rather than downgrading the user mid-session.
    } finally {
      set({ loading: false });
    }
  },

  claimTrial: async () => {
    const token = await useAccount.getState().getAccessToken();
    if (!token) return false;
    set({ loading: true, error: null });
    try {
      set({ entitlement: await api.claimTrial(token, await getInstallId()) });
      return true;
    } catch (e) {
      set({ error: e instanceof ApiFailure ? e.code : 'network' });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  clear: () => set({ entitlement: null, error: null }),

  applyUsage: (ai) => {
    const current = get().entitlement;
    if (current) set({ entitlement: { ...current, ai } });
  },
}));

/** True when the managed (our-key) AI path is usable right now: an active plan with quota left. */
export function hasManagedAi(e: Entitlement | null): boolean {
  return !!e && e.active && e.ai.used < e.ai.limit;
}

/** Non-hook read for module-level code (lens/translate helpers) that isn't inside a component. */
export const managedAiAvailable = (): boolean => hasManagedAi(useEntitlement.getState().entitlement);
