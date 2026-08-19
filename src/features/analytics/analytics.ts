import { db, type AnalyticsEvent } from '@/db/db';
import { ANALYTICS_ENDPOINT } from './config';

const ANON_KEY = 'analytics.anonId';
const FIRST_SEEN_KEY = 'analytics.firstSeen';
const OPT_OUT_KEY = 'analytics.optOut';
const DAY_MS = 86_400_000;
const MAX_BATCH = 50;

/** Random, non-identifying id kept only in this browser. Never derived from user data. */
function anonId(): string {
  let id = localStorage.getItem(ANON_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_KEY, id);
  }
  return id;
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
  if (!active()) return;
  try {
    await db.analyticsQueue.add({ event, props, ts: Date.now() });
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
