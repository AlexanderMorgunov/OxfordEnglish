import { create } from 'zustand';
import { captureDataScope } from './dataScope';
import { useAccount } from './store';
import { getInstallId } from '@/features/sync/meta';
import * as api from './api';
import { ApiFailure } from './api';
import type { Entitlement } from './contract';
import { track } from '@/features/analytics/analytics';

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
  if (current.resetsAt !== next.resetsAt) {
    return next.resetsAt != null && (current.resetsAt == null || next.resetsAt > current.resetsAt);
  }
  // Same window: two calls in flight can resolve out of order, and usage only ever grows.
  return next.used >= current.used;
}

const METADATA_DEADLINE_MS = 15_000;
let revision = 0;
let usageRevision = 0;
let planRevision = 0;
let loadFlight: { current: () => boolean; promise: Promise<void> } | null = null;
const pending = new Set<AbortController>();

function operation() {
  const account = useAccount.getState();
  const capturedRevision = revision;
  const scope = captureDataScope();
  const controller = new AbortController();
  pending.add(controller);
  const timer = setTimeout(() => controller.abort(), METADATA_DEADLINE_MS);
  const owned = () => {
    const next = useAccount.getState();
    return capturedRevision === revision && scope() &&
      account.accountId === next.accountId && account.sessionRevision === next.sessionRevision &&
      account.status === next.status;
  };
  const current = () => owned() && !controller.signal.aborted;
  const wait = <T,>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    controller.signal.addEventListener('abort', abort, { once: true });
    if (!current()) abort();
    promise.then(value => {
      if (current()) resolve(value);
      else abort();
    }, reject).finally(() => controller.signal.removeEventListener('abort', abort));
  });
  return { current, owned, wait, signal: controller.signal, finish: () => {
    clearTimeout(timer);
    pending.delete(controller);
  } };
}

export const useEntitlement = create<EntitlementState>((set, get) => ({
  entitlement: null,
  loading: false,
  error: null,

  load: () => {
    if (loadFlight?.current()) return loadFlight.promise;
    const op = operation();
    const startedUsage = usageRevision;
    const startedPlan = planRevision;
    set({ loading: true });
    const flight = { current: op.current, promise: Promise.resolve() };
    loadFlight = flight;
    flight.promise = (async () => {
      try {
        const token = await op.wait(useAccount.getState().getAccessToken());
        if (!token || !op.current()) return;
        const loaded = await op.wait(api.getEntitlement(token, op.signal));
        if (!op.current() || startedPlan !== planRevision || loadFlight !== flight) return;
        const held = get().entitlement;
        let entitlement = loaded;
        if (held && startedUsage !== usageRevision && held.plan === loaded.plan && held.ai.limit === loaded.ai.limit &&
          !acceptsUsage(held.ai, loaded.ai)) entitlement = { ...loaded, ai: held.ai };
        // The plan read has no installation-level trial eligibility; it cannot undo a known denial.
        const error = loaded.plan === 'free' && !loaded.trialEndsAt && get().error === 'trial_already_claimed'
          ? 'trial_already_claimed' : null;
        set({ entitlement, error });
      } catch {
        // A transient failure must not downgrade a known subscription.
      } finally {
        op.finish();
        if (loadFlight === flight) loadFlight = null;
        if (op.owned()) set({ loading: pending.size > 0 });
      }
    })();
    return flight.promise;
  },

  claimTrial: async () => {
    const before = get().entitlement;
    const unusedFree = before?.plan === 'free' && before.trialEndsAt == null;
    const op = operation();
    const claimRevision = ++planRevision;
    const current = () => op.current() && claimRevision === planRevision;
    set({ loading: true, error: null });
    try {
      const token = await op.wait(useAccount.getState().getAccessToken());
      if (!token) {
        if (current()) set({ error: 'network' });
        return 'network';
      }
      const installId = await op.wait(getInstallId());
      if (!current()) return 'failed';
      const entitlement = await op.wait(api.claimTrial(token, installId, op.signal));
      if (!current()) return 'failed';
      planRevision += 1;
      set({ entitlement, error: null });
      if (unusedFree && entitlement.plan === 'trial' && entitlement.active) void track('trial_started');
      return 'ok';
    } catch (e) {
      if (!op.owned() || claimRevision !== planRevision) return 'failed';
      const code = e instanceof ApiFailure ? e.code : 'network';
      // A lost response can hide a successful grant; reconcile through a fresh read.
      loadFlight = null;
      await get().load();
      if (!op.owned() || claimRevision !== planRevision) return 'failed';
      if (get().entitlement?.active) {
        set({ error: null });
        return 'ok';
      }
      set({ error: code });
      if (code === 'trial_already_claimed') return 'already-claimed';
      return code === 'network' ? 'network' : 'failed';
    } finally {
      const ownerCurrent = op.owned();
      op.finish();
      if (ownerCurrent) set({ loading: pending.size > 0 });
    }
  },

  clear: () => {
    revision += 1;
    planRevision += 1;
    loadFlight = null;
    for (const controller of pending) controller.abort();
    pending.clear();
    set({ entitlement: null, error: null, loading: false });
  },

  applyUsage: (ai) => {
    const current = get().entitlement;
    if (!current || !acceptsUsage(current.ai, ai)) return;
    usageRevision += 1;
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
  if (e.plan === 'trial' && (e.trialEndsAt == null || e.trialEndsAt > now)) return 'trial';
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
        ? 'Лимит AI на этот период закончился. Он восстановится после продления Pro. Бесплатный перевод слов работает.'
        : 'The AI limit for this period is reached. It renews when you extend Pro. Free word translation still works.',
    };
  }

  return {
    level,
    text: resets
      ? ru
        ? `Лимит AI закончился. Он восстановится ${resets}. Бесплатный перевод слов работает.`
        : `The AI limit is reached. It resets on ${resets}. Free word translation still works.`
      : ru
        ? 'Вы использовали весь лимит AI в пробном периоде. Подключите Pro, чтобы продолжить. Бесплатный перевод слов работает.'
        : 'You have used the trial AI limit. Get Pro to continue. Free word translation still works.',
  };
}
