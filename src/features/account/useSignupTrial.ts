import { useEffect, useRef, useState } from 'react';
import type { Entitlement } from './contract';
import { subscriptionState, useEntitlement } from './entitlement';
import { captureAccountSessionOwner } from './store';

export type SignupTrialPhase =
  'idle' | 'pending' | 'uncertain' | 'failed' | 'unavailable' | 'complete';

export function useSignupTrial() {
  const [phase, setPhase] = useState<SignupTrialPhase>('idle');
  const mounted = useRef(true);
  const owner = useRef<(() => boolean) | null>(null);
  const flight = useRef(false);
  const revision = useRef(0);
  const completion = useRef<((plan: Entitlement) => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      mounted.current = false;
      owner.current = null;
      revision.current++;
      flight.current = false;
    };
    const show = () => {
      mounted.current = true;
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      hide();
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, []);

  const reset = () => {
    revision.current++;
    flight.current = false;
    owner.current = null;
    completion.current = null;
    setPhase('idle');
  };
  const run = async (checkOnly: boolean) => {
    if (flight.current || !owner.current?.() || !mounted.current) return;
    flight.current = true;
    const generation = revision.current;
    const current = () =>
      mounted.current && owner.current?.() && generation === revision.current;
    setPhase('pending');
    try {
      const plan = await useEntitlement.getState().load();
      if (!current()) return;
      if (!plan) {
        setPhase('uncertain');
        return;
      }
      const state = subscriptionState(plan, Date.now());
      if (plan.active && (state === 'pro' || state === 'trial')) {
        setPhase('complete');
        completion.current?.(plan);
        return;
      }
      if (
        state !== 'none' ||
        useEntitlement.getState().error === 'trial_already_claimed'
      ) {
        setPhase('unavailable');
        return;
      }
      if (checkOnly) {
        setPhase('failed');
        return;
      }
      const outcome = await useEntitlement.getState().claimTrial();
      if (!current()) return;
      const confirmed = useEntitlement.getState().entitlement;
      const confirmedState = subscriptionState(confirmed, Date.now());
      if (
        outcome === 'ok' &&
        confirmed?.active &&
        (confirmedState === 'trial' || confirmedState === 'pro')
      ) {
        setPhase('complete');
        completion.current?.(confirmed);
      } else
        setPhase(
          outcome === 'already-claimed'
            ? 'unavailable'
            : outcome === 'network'
              ? 'uncertain'
              : 'failed'
        );
    } catch {
      if (current()) setPhase('uncertain');
    } finally {
      if (generation === revision.current) flight.current = false;
    }
  };
  return {
    phase,
    reset,
    start: async (done: (plan: Entitlement) => void) => {
      if (flight.current) return;
      owner.current = captureAccountSessionOwner();
      completion.current = done;
      await run(false);
    },
    retry: () => run(false),
    check: () => run(true),
    restore: async (done: (plan: Entitlement) => void) => {
      if (flight.current) return;
      owner.current = captureAccountSessionOwner();
      completion.current = done;
      await run(true);
    },
  };
}
