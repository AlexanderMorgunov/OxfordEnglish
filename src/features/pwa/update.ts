import { registerSW } from 'virtual:pwa-register';

let started = false;
let registration: ServiceWorkerRegistration | undefined;

/** Register the service worker in auto-update mode. A new deploy's SW skips waiting, claims clients
 *  and reloads the page onto the fresh build — so even a client stuck on an old cached SW self-heals
 *  on its next load (a stale course.json once hid new content on prod and installed PWAs). An
 *  always-open PWA never navigates, so we re-check on focus/visibility (not a timer — that would risk
 *  reloading an active session mid-exercise). Called once from main.tsx. */
export function initAppUpdate(): void {
  if (started) return;
  started = true;
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, r) {
      if (!r) return;
      registration = r;
      const check = () => void r.update().catch(() => {});
      window.addEventListener('focus', check);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

/** Manually ask the browser to check for a new service worker. In auto-update mode a newly-found SW
 *  activates and reloads on its own; `'unavailable'` when no registration exists yet (offline first
 *  load, or SW registration failed). */
export async function checkForAppUpdate(): Promise<'checked' | 'unavailable'> {
  if (!registration) return 'unavailable';
  await registration.update();
  return 'checked';
}
