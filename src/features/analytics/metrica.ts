import { isAnalyticsEnabled } from './analytics';
import { getAttribution } from './attribution';

const METRICA_ID = import.meta.env.VITE_YANDEX_METRICA_ID;

type Ym = ((...args: unknown[]) => void) & { a?: unknown[]; l?: number };
declare global {
  interface Window {
    ym?: Ym;
  }
}

const dntOff = (): boolean => {
  const dnt = typeof navigator !== 'undefined' ? navigator.doNotTrack : null;
  return dnt !== '1' && dnt !== 'yes';
};

/** A counter id is configured (build-time). Used to show the analytics toggle in Settings. */
export const metricaConfigured = (): boolean => Boolean(METRICA_ID);

/** Metrica runs only when a counter id is configured, analytics isn't opted out, and DNT is off. */
export function metricaActive(): boolean {
  return Boolean(METRICA_ID) && isAnalyticsEnabled() && dntOff();
}

let started = false;

/**
 * Load the Metrica tag (once) and init the counter. A no-op — and NO script or cookies — when
 * inactive (no id / opted out / DNT). Minimal init (`defer` only, no clickmap/trackLinks/webvisor)
 * so our explicit `metricaHit` calls are the ENTIRE egress: opting out then genuinely stops it.
 */
export function initMetrica(): void {
  if (started || typeof window === 'undefined' || !metricaActive()) return;
  started = true;
  // Canonical Metrica bootstrap: the queue stub must exist before tag.js loads, or this init call
  // is silently dropped.
  if (!window.ym) {
    const q = function (...args: unknown[]) {
      (q.a = q.a || []).push(args);
    } as Ym;
    q.l = Date.now();
    window.ym = q;
  }
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.appendChild(s);
  window.ym(Number(METRICA_ID), 'init', { defer: true });
  // First-touch acquisition as visitor-level params, so every visit carries where the user
  // originally came from (Metrica's own utm/referrer attribution is per-visit, last-non-direct).
  const attr = getAttribution();
  if (attr) window.ym(Number(METRICA_ID), 'userParams', { firstTouch: attr });
}

/** Report a conversion to Metrica as a JS goal. The goal id must be created in the Metrica dashboard
 *  (identifier = `name`) to appear in reports; an unconfigured id is a harmless no-op. */
export function metricaGoal(name: string): void {
  if (!metricaActive() || !window.ym) return;
  window.ym(Number(METRICA_ID), 'reachGoal', name);
}

let lastHitPath: string | null = null;

/** Send an SPA page-view. Deduped by path so React StrictMode's dev double-mount can't double-count. */
export function metricaHit(path: string): void {
  if (!metricaActive() || !window.ym || path === lastHitPath) return;
  lastHitPath = path;
  window.ym(Number(METRICA_ID), 'hit', path);
}
