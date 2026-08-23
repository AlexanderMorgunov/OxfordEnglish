import { registerSW } from 'virtual:pwa-register';

let updateSW: ((reload?: boolean) => Promise<void>) | undefined;
let registration: ServiceWorkerRegistration | undefined;
let needRefresh = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Register the service worker (prompt mode) and start watching for new deploys. Called once
 *  from main.tsx. An installed PWA that stays open never reloads, so it would otherwise never
 *  notice a new deploy — we poll `registration.update()` on a timer and on focus/visibility. */
export function initAppUpdate(): void {
  if (updateSW) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      emit();
    },
    onRegisteredSW(_swUrl, r) {
      registration = r;
      if (!r) return;
      const check = () => void r.update().catch(() => {});
      setInterval(check, 60_000);
      window.addEventListener('focus', check);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

export function subscribeAppUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isUpdateReady(): boolean {
  return needRefresh;
}

/** Activate the waiting service worker and reload into the new version. */
export async function applyAppUpdate(): Promise<void> {
  await updateSW?.(true);
}

/** Ask the browser to check for a new service worker right now. Resolves once the check finishes;
 *  if a new version is found, `onNeedRefresh` flips `isUpdateReady()` shortly after. */
export async function checkForAppUpdate(): Promise<void> {
  await registration?.update();
}
