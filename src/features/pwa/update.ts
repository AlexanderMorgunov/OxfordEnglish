import { registerSW } from 'virtual:pwa-register';

let updateSW: ((reload?: boolean) => Promise<void>) | undefined;
let registration: ServiceWorkerRegistration | undefined;
let needRefresh = false;
// Whether the user has started doing something this session. A waiting update found *before*
// engagement opens the launch modal (a reload is free — no in-progress work); found *after*, it
// falls to the slim banner instead of interrupting. Module scope ⇒ immune to StrictMode remounts.
let engaged = false;
let modalActive = false;
let modalDismissed = false;
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
      if (!engaged && !modalDismissed) modalActive = true;
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

/** The user has begun using the app; later-found updates go to the banner, not the launch modal. */
export function markEngaged(): void {
  engaged = true;
}

/** Banner: an update is waiting and it's not being shown as the launch modal. */
export function isUpdateReady(): boolean {
  return needRefresh && !modalActive;
}

/** Launch modal: an update was found before the user engaged, and hasn't been dismissed. */
export function isUpdateModalOpen(): boolean {
  return modalActive;
}

/** Record the launch modal as dismissed for this session (called from the dialog `close` event so
 *  Escape/backdrop count too). The banner remains as the fallback affordance. */
export function dismissUpdateModal(): void {
  modalActive = false;
  modalDismissed = true;
  emit();
}

/** Activate the waiting service worker and reload into the new version. (vite-plugin-pwa ignores
 *  the boolean arg; the reload is driven unconditionally by workbox's `controlling` listener.) */
export async function applyAppUpdate(): Promise<void> {
  await updateSW?.();
}

/** Manually ask the browser to check for a new service worker. `'unavailable'` when no
 *  registration exists yet (offline first load, or SW registration failed). */
export async function checkForAppUpdate(): Promise<'checked' | 'unavailable'> {
  if (!registration) return 'unavailable';
  await registration.update();
  return 'checked';
}
