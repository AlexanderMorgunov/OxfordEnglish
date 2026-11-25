import { App } from '@capacitor/app';
import { z } from 'zod';
import { create } from 'zustand';
import { API_BASE } from '@/features/account/config';
import { captureAccountSessionOwner, subscribeAccountSessionStorage, useAccount } from '@/features/account/store';
import { isNativePlatform } from '@/shared/lib/platform';

const FeatureResponse = z.object({
  version: z.literal(1),
  validForMs: z.number().int().positive().max(30_000),
  features: z.object({
    games_catalog: z.object({
      allowed: z.boolean(),
      androidAllowed: z.boolean().default(false),
      revision: z.number().int().nonnegative(),
    }),
  }),
});

type Access = 'loading' | 'allowed' | 'denied' | 'error' | 'suspended' | 'session-changed';
export const useGameAvailability = create<{ access: Access; epoch: number }>(() => ({
  access: 'loading', epoch: 0,
}));
const currentSession = () => {
  const { accountId, sessionRevision, status } = useAccount.getState();
  return JSON.stringify([accountId, sessionRevision, status]);
};
let session: string | undefined;
let sessionOwner: (() => boolean) | undefined;
let expires: { monotonic: number; wall: number } | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let pending: { controller: AbortController; task: Promise<void> } | undefined;
let active = true;

function clearExpiry() {
  clearTimeout(expiryTimer);
  expires = undefined;
}
function setAccess(access: Access) {
  useGameAvailability.setState({ access });
}
function reset(access: Access) {
  pending?.controller.abort();
  pending = undefined;
  clearExpiry();
  useGameAvailability.setState((previous) => ({ access, epoch: previous.epoch + 1 }));
}
function finishRequest(controller: AbortController) {
  if (pending?.controller === controller) pending = undefined;
}
async function tokenWithin(signal: AbortSignal): Promise<string | null> {
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      useAccount.getState().getAccessToken(),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
function expire() {
  if (useGameAvailability.getState().access === 'allowed' && !gameAccessAllowed())
    setAccess('suspended');
}
export function gameAccessAllowed(): boolean {
  return useGameAvailability.getState().access === 'allowed' &&
    session === currentSession() && sessionOwner?.() === true && expires !== undefined &&
    performance.now() < expires.monotonic && Date.now() < expires.wall;
}

export function refreshGameAvailability(): Promise<void> {
  const owner = currentSession();
  if (session !== owner) {
    session = owner;
    sessionOwner = captureAccountSessionOwner();
    reset('loading');
  }
  if (!sessionOwner?.()) {
    if (useGameAvailability.getState().access !== 'session-changed') reset('session-changed');
    return Promise.resolve();
  }
  expire();
  if (!active || document.visibilityState === 'hidden') return Promise.resolve();
  if (pending) return pending.task;
  if (!API_BASE) {
    setAccess('denied');
    return Promise.resolve();
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
  const ownsRequest = sessionOwner;
  const current = () => !controller.signal.aborted && owner === currentSession() && ownsRequest();
  const task = (async () => {
    try {
      const token = await tokenWithin(signal);
      if (!current()) return;
      signal.throwIfAborted();
      if (useAccount.getState().status === 'authenticated' && !token)
        throw new Error('Session unavailable');
      const response = await fetch(`${API_BASE}/v1/features`, {
        cache: 'no-store',
        signal,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!current()) return;
      if (response.status === 404 || response.status === 401) {
        reset('denied');
        return;
      }
      if (!response.ok) throw new Error('Feature settings unavailable');
      const data = FeatureResponse.parse(await response.json());
      if (!current()) return;
      signal.throwIfAborted();
      const game = data.features.games_catalog;
      if (!(game.allowed && (!isNativePlatform() || game.androidAllowed))) {
        if (useGameAvailability.getState().access !== 'denied') reset('denied');
        return;
      }
      const ttl = data.validForMs;
      clearExpiry();
      expires = { monotonic: performance.now() + ttl, wall: Date.now() + ttl };
      expiryTimer = setTimeout(expire, ttl);
      setAccess('allowed');
    } catch {
      if (!current()) return;
      expire();
      const { access } = useGameAvailability.getState();
      if (access === 'loading' || access === 'error') setAccess('error');
    } finally {
      finishRequest(controller);
    }
  })();
  pending = { controller, task };
  return task;
}

export function invalidateGameAvailability() {
  reset('denied');
  void refreshGameAvailability();
}

export function connectGameAvailability(): () => void {
  active = true;
  const check = () => { void refreshGameAvailability(); };
  const unsubscribe = useAccount.subscribe((s, previous) => {
    if (s.accountId !== previous.accountId || s.sessionRevision !== previous.sessionRevision ||
        s.status !== previous.status) check();
  });
  const unsubscribeStorage = subscribeAccountSessionStorage(check);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  const interval = setInterval(check, 20_000);
  let disposed = false;
  const listener = isNativePlatform()
    ? App.addListener('appStateChange', ({ isActive }) => {
        active = isActive;
        if (isActive) check();
      }).then((handle) => {
        if (disposed) {
          void handle.remove();
          return undefined;
        }
        return handle;
      }).catch(() => undefined)
    : undefined;
  check();
  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeStorage();
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('online', check);
    clearInterval(interval);
    void listener?.then((handle) => handle?.remove());
    session = undefined;
    sessionOwner = undefined;
    reset('loading');
  };
}
