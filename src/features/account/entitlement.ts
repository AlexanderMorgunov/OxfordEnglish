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

/** How much of the AI budget is gone. `spent` gates the managed path; `warn` is the heads-up before it. */
export const QUOTA_WARN_AT = 0.8;

export type QuotaLevel = 'ok' | 'warn' | 'spent';

export function quotaLevel(e: Entitlement | null): QuotaLevel {
  if (!e || !e.active || e.ai.limit <= 0) return 'ok'; // no plan — the paywall speaks, not the quota
  if (e.ai.used >= e.ai.limit) return 'spent';
  return e.ai.used / e.ai.limit >= QUOTA_WARN_AT ? 'warn' : 'ok';
}

/**
 * What to tell the user about their AI budget, or null when there is nothing worth saying.
 *
 * Running out used to surface as whatever generic failure each caller happened to render, which reads as
 * "the app is broken" rather than "you have used this month's budget". The reset date is the part that
 * matters: a Pro window rolls, a trial budget is one-time and never does.
 */
export function quotaNotice(e: Entitlement | null, ru: boolean): { level: 'warn' | 'spent'; text: string } | null {
  const level = quotaLevel(e);
  if (level === 'ok' || !e) return null;
  const left = Math.max(0, e.ai.limit - e.ai.used);

  if (level === 'warn') {
    return {
      level,
      text: ru
        ? `ИИ-запросы почти израсходованы: осталось ${left} из ${e.ai.limit}.`
        : `AI budget almost spent: ${left} of ${e.ai.limit} left.`,
    };
  }

  const resets = e.ai.resetsAt
    ? new Date(e.ai.resetsAt).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' })
    : null;
  return {
    level,
    text: resets
      ? ru
        ? `ИИ-запросы на этот период израсходованы. Обновятся ${resets}. Перевод слов продолжает работать, а разборы и упрощение вернутся после обновления — или сразу, если добавить свой ключ ИИ в настройках.`
        : `This period's AI budget is spent. It resets on ${resets}. Word translation keeps working; explanations and simplification return after the reset — or right away if you add your own AI key in settings.`
      : ru
        ? `ИИ-запросы пробного периода израсходованы — он даёт ${e.ai.limit} единиц один раз. Перевод слов продолжает работать; для разборов и упрощения оформите подписку или добавьте свой ключ ИИ в настройках.`
        : `The trial's AI budget is spent — it grants ${e.ai.limit} units once. Word translation keeps working; for explanations and simplification, subscribe or add your own AI key in settings.`,
  };
}
