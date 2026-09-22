import { quotaLevel, quotaOutlivesPlan } from '@/features/account/entitlement';
import type { Status } from '@/features/account/store';
import type { Entitlement } from '@/features/account/contract';

/**
 * Where an AI affordance should send someone who cannot use it right now.
 *
 * This is a pure function on purpose: the states are easy to get wrong and expensive when you do — the
 * bug this replaces showed a PAYING subscriber who had used up the month's budget the same "set up AI"
 * link a stranger sees, which reads as being asked to pay twice.
 *
 * Callers only reach this when `useAiEnabled()` is already false, so "has a working AI path" is not a
 * state that arrives here from the app — it is still returned for completeness and tested, because the
 * component contract is "render nothing when there is nothing to say".
 */
export type UpsellTarget =
  /** Nothing to say — an AI path is available. */
  | 'none'
  /** Paid plan, budget spent, and it refills on a date we can name. Never quote a price at someone
   *  who has already paid for this period. */
  | 'quota-resets'
  /** Paid plan, budget spent, and the "reset" is the day the subscription ends — a first month, where
   *  the quota window and the paid period are the same thirty days. Naming that date as a refill is a
   *  promise we cannot keep, so this state offers the one thing that does bring the budget back. */
  | 'quota-until-renewal'
  /** The one-time trial budget is gone and nothing will refill it. The highest-intent person in the
   *  funnel: they tried the thing, used all of it, and want more. */
  | 'quota-final'
  /** Signed in, but we could not read the plan — offline, a cold start, or a failed request.
   *  Entitlement is deliberately never cached, so for a subscriber this is an ordinary state.
   *  Say nothing definite and NEVER a price. */
  | 'unknown'
  /** No plan and no key. This is the only state that should see the plans page. */
  | 'plans';

export function upsellTarget(status: Status, entitlement: Entitlement | null): UpsellTarget {
  // Anonymous: there is no plan to read and none to lose. Straight to the explanation.
  if (status !== 'authenticated') return 'plans';
  if (!entitlement) return 'unknown';
  if (!entitlement.active) return 'plans';

  if (quotaLevel(entitlement) === 'spent') {
    // `resetsAt` is the discriminator, not the plan name: the server sets it only for a paid window
    // (server/src/entitlements.ts), so a spent TRIAL has none — for that person the budget is simply
    // over, and pointing them at "it refills on the 3rd" would be a lie.
    if (entitlement.ai.resetsAt == null) return 'quota-final';
    return quotaOutlivesPlan(entitlement) ? 'quota-until-renewal' : 'quota-resets';
  }

  // Active plan with budget left: the caller should not have asked, but nothing is wrong either.
  return 'none';
}
