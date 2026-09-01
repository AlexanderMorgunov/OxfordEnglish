import { isAnalyticsEnabled } from './analytics';

const KEY = 'analytics.attribution';
const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const;

export type Attribution = {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
  /** Referrer HOSTNAME only — never the full URL. */
  referrer?: string;
  landing: string;
  ts: number;
};

const dntOff = (): boolean => {
  const d = typeof navigator !== 'undefined' ? navigator.doNotTrack : null;
  return d !== '1' && d !== 'yes';
};

/** Referrer hostname only (never path/query — avoids leaking anything sensitive). Undefined for a
 *  direct hit or a same-site navigation, so only real off-site acquisition is recorded. */
function referrerHost(): string | undefined {
  try {
    if (!document.referrer) return undefined;
    const u = new URL(document.referrer);
    if (u.hostname === location.hostname) return undefined;
    return u.hostname;
  } catch {
    return undefined;
  }
}

/**
 * Record FIRST-touch acquisition once (utm_* + referrer host + landing path). First touch wins and is
 * never overwritten, so a later same-site page or a returning visit can't erase where the user first
 * came from. localStorage only — no network. Respects opt-out and DNT. Stored only when there is a real
 * acquisition signal (utm or an external referrer), so a plain direct visit doesn't lock in "direct".
 */
export function captureAttribution(): void {
  try {
    if (!isAnalyticsEnabled() || !dntOff()) return;
    if (localStorage.getItem(KEY)) return;
    const params = new URLSearchParams(location.search);
    const attr: Attribution = { landing: location.pathname, ts: Date.now() };
    let hasUtm = false;
    for (const k of UTM_KEYS) {
      const v = params.get(`utm_${k}`);
      if (v) {
        attr[k] = v.slice(0, 100);
        hasUtm = true;
      }
    }
    const ref = referrerHost();
    if (ref) attr.referrer = ref;
    if (!hasUtm && !ref) return;
    localStorage.setItem(KEY, JSON.stringify(attr));
  } catch {
    // localStorage unavailable — attribution is best-effort
  }
}

export function getAttribution(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}
