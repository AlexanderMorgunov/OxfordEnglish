import { db, type AnalyticsEvent } from '@/db/db';
import { ANALYTICS_ENDPOINT } from './config';
import { metricaGoal } from './metrica';
import { getAttribution } from './attribution';

/** Conversion milestones mirrored to Metrica as goals (roughly once-per-user). Kept off high-frequency
 *  events (e.g. book_open) so they don't inflate goal counts and poison per-source comparison. */
const METRICA_GOALS = new Set(['placement_done', 'onboarding_end', 'day_complete', 'pwa_installed']);

const ANON_KEY = 'analytics.anonId';
const FIRST_SEEN_KEY = 'analytics.firstSeen';
const OPT_OUT_KEY = 'analytics.optOut';
const DAY_MS = 86_400_000;
const MAX_BATCH = 50;
const MAX_QUEUE = 500;

/** crypto.randomUUID is undefined outside a secure context (e.g. plain-http LAN testing). */
function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Random, non-identifying id kept only in this browser. Never derived from user data. */
function anonId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
}

/** True only when analytics is actually configured — the UI uses this to avoid claiming
 *  collection is happening while the app ships with no endpoint. */
export function analyticsConfigured(): boolean {
  return ANALYTICS_ENDPOINT !== '';
}

function firstSeen(): number {
  const raw = localStorage.getItem(FIRST_SEEN_KEY);
  if (raw) return Number(raw);
  const now = Date.now();
  localStorage.setItem(FIRST_SEEN_KEY, String(now));
  return now;
}

export function isAnalyticsEnabled(): boolean {
  return localStorage.getItem(OPT_OUT_KEY) !== '1';
}

export function setAnalyticsEnabled(on: boolean): void {
  if (on) localStorage.removeItem(OPT_OUT_KEY);
  else localStorage.setItem(OPT_OUT_KEY, '1');
}

/** Whole thing is a no-op unless an endpoint is configured, the user hasn't opted out, and DNT is off. */
function active(): boolean {
  if (!ANALYTICS_ENDPOINT) return false;
  if (!isAnalyticsEnabled()) return false;
  if (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes') return false;
  return true;
}

/** Days since first launch — the axis retention cohorts are grouped on. */
export function retentionDay(now: number, seen: number): number {
  return Math.max(0, Math.floor((now - seen) / DAY_MS));
}

export async function track(
  event: string,
  props?: AnalyticsEvent['props']
): Promise<void> {
  // Mirror conversions to Metrica independently of the custom endpoint (which is inert until one is set)
  // — this is what makes "which channel converts" answerable via Metrica's built-in source reports.
  if (METRICA_GOALS.has(event)) metricaGoal(event);
  if (!active()) return;
  try {
    await db.analyticsQueue.add({ event, props, ts: Date.now() });
    // Bound the queue so a mistyped or dead endpoint can't grow IndexedDB without limit.
    const excess = (await db.analyticsQueue.count()) - MAX_QUEUE;
    if (excess > 0) {
      const stale = await db.analyticsQueue.orderBy('ts').limit(excess).primaryKeys();
      await db.analyticsQueue.bulkDelete(stale);
    }
  } catch {
    // queue is best-effort; a full/absent IndexedDB must never break the app
  }
  void flush();
}

let flushing = false;

export async function flush(): Promise<void> {
  if (!active() || flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const batch = await db.analyticsQueue.orderBy('ts').limit(MAX_BATCH).toArray();
    if (batch.length === 0) return;
    const res = await fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        anonId: anonId(),
        firstSeen: firstSeen(),
        attribution: getAttribution(),
        events: batch.map(({ event, props, ts }) => ({ event, props, ts })),
      }),
    });
    if (!res.ok) return;
    await db.analyticsQueue.bulkDelete(
      batch.map((e) => e.id).filter((id): id is number => id != null)
    );
  } catch {
    // offline or endpoint down: rows stay queued for the next flush
  } finally {
    flushing = false;
  }
}

export function initAnalytics(): void {
  if (!active()) return;
  window.addEventListener('online', () => void flush());
  void track('app_open', { retentionDay: retentionDay(Date.now(), firstSeen()) });
}
