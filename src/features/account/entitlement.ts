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
/**
 * Why a trial claim ended the way it did. A bare boolean made every failure read as
 * "already used it" — including the case where no request was ever sent.
 */
export type TrialClaim = 'ok' | 'already-claimed' | 'network' | 'failed';

type EntitlementState = {
  entitlement: Entitlement | null;
  loading: boolean;
  /** Last error code from a claim attempt, for the UI to explain (e.g. `trial_already_claimed`). */
  error: string | null;
  load: () => Promise<void>;
  claimTrial: () => Promise<TrialClaim>;
  clear: () => void;
  /** Apply the quota figures the AI proxy returns, so the counter moves without an extra round-trip. */
  applyUsage: (ai: Entitlement['ai']) => void;
};

/**
 * Whether a usage block returned by the AI proxy is newer than the one we hold.
 *
 * The proxy computes its figures when the request reaches it, so an answer can arrive after the plan
 * underneath it has changed. Applied blindly, a reply computed under a spent trial and delivered after
 * a purchase gave a fresh subscriber `used >= limit` and no `resetsAt` — which the upsell logic reads
 * as "trial over, pay up", to someone who had just paid.
 */
function acceptsUsage(current: Entitlement['ai'], next: Entitlement['ai']): boolean {
  // A different budget means a different plan window: the answer was computed against a plan we are no
  // longer on. The next load() carries the authoritative figures.
  if (current.limit !== next.limit) return false;
  // A new window legitimately resets the counter, so it is the one case where `used` may fall.
  if (current.resetsAt !== next.resetsAt) return true;
  // Same window: two calls in flight can resolve out of order, and usage only ever grows.
  return next.used >= current.used;
}

export const useEntitlement = create<EntitlementState>((set, get) => ({
  entitlement: null,
  loading: false,
  error: null,

  load: async () => {
    const token = await useAccount.getState().getAccessToken();
    // No token is not "no plan": `getAccessToken` returns null whenever a refresh fails, which on a bad
    // connection it does silently. Nulling here downgraded a paying subscriber mid-session — the very
    // thing the catch below refuses to do. Signing out clears this explicitly (features/sync/run.ts).
    if (!token) return;
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
    // Nothing was sent, and re-checking would ask the same question of the same failed refresh.
    if (!token) {
      set({ error: 'network' });
      return 'network';
    }
    set({ loading: true, error: null });
    try {
      set({ entitlement: await api.claimTrial(token, await getInstallId()) });
      return 'ok';
    } catch (e) {
      const code = e instanceof ApiFailure ? e.code : 'network';
      // The grant may well have landed with only the answer lost — on a flaky link that is the likeliest
      // reading. Ask the server what it holds before telling someone their trial failed.
      await get().load();
      if (get().entitlement?.active) {
        set({ error: null });
        return 'ok';
      }
      set({ error: code });
      if (code === 'trial_already_claimed') return 'already-claimed';
      return code === 'network' ? 'network' : 'failed';
    } finally {
      set({ loading: false });
    }
  },

  clear: () => set({ entitlement: null, error: null }),

  applyUsage: (ai) => {
    const current = get().entitlement;
    if (!current || !acceptsUsage(current.ai, ai)) return;
    set({ entitlement: { ...current, ai } });
  },
}));

/** True when the managed (our-key) AI path is usable right now: an active plan with quota left. */
export function hasManagedAi(e: Entitlement | null): boolean {
  return !!e && e.active && e.ai.used < e.ai.limit;
}

/** Non-hook read for module-level code (lens/translate helpers) that isn't inside a component. */
export const managedAiAvailable = (): boolean => hasManagedAi(useEntitlement.getState().entitlement);

export type SubscriptionState = 'pro' | 'trial' | 'expired' | 'trial-over' | 'none' | 'unknown';

/**
 * Which of these a person is, decided once. The plan caption, the buy button and (later) the expiry
 * reminder all hang off this answer rather than testing the fields themselves — three separate tests of
 * the same thing drift, which is how a heading ended up contradicting its own paragraph on the payment
 * return page.
 *
 * `paidUntil` outranks `trialEndsAt` deliberately. The server stamps `trialEndsAt` on anyone who ever
 * had a trial, so reading it first told the path trial → paid → lapsed that their FREE TRIAL had run
 * out — said, of all people, to someone who had paid.
 *
 * The clock is an argument because a plan can run out while the app is open: entitlement is fetched at
 * boot and a PWA living in a phone's memory through midnight would otherwise keep reporting Pro until
 * the first 402. A Pro with no date at all is left alone — missing data is not an expiry.
 */
export function subscriptionState(e: Entitlement | null, now: number): SubscriptionState {
  if (!e) return 'unknown';
  if (e.plan === 'pro' && (e.paidUntil == null || e.paidUntil > now)) return 'pro';
  if (e.plan === 'trial') return 'trial';
  if (e.paidUntil != null) return 'expired';
  if (e.trialEndsAt != null) return 'trial-over';
  return 'none';
}

const date = (ms: number, ru: boolean): string =>
  new Date(ms).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' });

export function planLine(e: Entitlement, state: SubscriptionState, ru: boolean): string {
  const on = (ms: number | undefined): string => (ms == null ? '—' : date(ms, ru));
  switch (state) {
    case 'pro':
      return ru ? `Pro — активна до ${on(e.paidUntil)}` : `Pro — active until ${on(e.paidUntil)}`;
    case 'trial':
      return ru ? `Пробный период — до ${on(e.trialEndsAt)}` : `Free trial — until ${on(e.trialEndsAt)}`;
    case 'expired':
      return ru ? `Подписка закончилась ${on(e.paidUntil)}` : `Your subscription ended on ${on(e.paidUntil)}`;
    case 'trial-over':
      return ru ? `Пробный период закончился ${on(e.trialEndsAt)}` : `Your free trial ended on ${on(e.trialEndsAt)}`;
    case 'none':
      return ru ? 'Бесплатный план' : 'Free plan';
    case 'unknown':
      return ru ? 'План неизвестен' : 'Plan unknown';
  }
}

/**
 * Signed in, but we hold no answer about the plan — a cold start, or a request that did not land.
 * Distinct from "no plan": the server may well grant this, so the only honest move is to ask it rather
 * than to decide locally that the user cannot have the feature.
 */
export const planUnreadable = (): boolean =>
  useAccount.getState().status === 'authenticated' &&
  subscriptionState(useEntitlement.getState().entitlement, Date.now()) === 'unknown';

/** How much of the AI budget is gone. `spent` gates the managed path; `warn` is the heads-up before it. */
export const QUOTA_WARN_AT = 0.8;

export type QuotaLevel = 'ok' | 'warn' | 'spent';

export function quotaLevel(e: Entitlement | null): QuotaLevel {
  if (!e || !e.active || e.ai.limit <= 0) return 'ok'; // no plan — the paywall speaks, not the quota
  if (e.ai.used >= e.ai.limit) return 'spent';
  return e.ai.used / e.ai.limit >= QUOTA_WARN_AT ? 'warn' : 'ok';
}

/**
 * True when the quota window does not end before the paid period does — so the "reset" the app keeps
 * promising is really the day the subscription runs out.
 *
 * This is the whole of a first month. `applyPayment` starts the quota window at the moment of payment
 * and the plan runs thirty days; `PRO_WINDOW_MS` is thirty days too, so `resetsAt` and `paidUntil`
 * are the same millisecond. Telling someone their budget "resets on 22 October" when the subscription
 * ends on 22 October is a promise the app cannot keep, and it was made to the people who had paid.
 *
 * Renewing mid-period moves `paidUntil` forward and leaves the window where it was, so from the second
 * month the reset genuinely comes first and the ordinary wording is right.
 */
export function quotaOutlivesPlan(e: Entitlement | null): boolean {
  return e?.ai.resetsAt != null && e.paidUntil != null && e.ai.resetsAt >= e.paidUntil;
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

  // Nothing refills before the plan ends: say so, and point at the thing that would actually help.
  if (quotaOutlivesPlan(e)) {
    return {
      level,
      text: ru
        ? `ИИ-запросы на этот период израсходованы и вернутся с продлением подписки. Перевод слов продолжает работать, а разборы и упрощение — сразу, если добавить свой ключ ИИ в настройках.`
        : `This period's AI budget is spent and comes back when you extend the subscription. Word translation keeps working; explanations and simplification return right away if you add your own AI key in settings.`,
    };
  }

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
