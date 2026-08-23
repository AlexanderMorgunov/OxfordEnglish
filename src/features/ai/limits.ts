export type KeyLimits = {
  provider: string;
  limitRequests?: number;
  remainingRequests?: number;
  limitTokens?: number;
  remainingTokens?: number;
  resetRequests?: string;
  resetTokens?: string;
  at: number;
};

const KEY = 'oxford-ai-limits';
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

function load(): KeyLimits | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as KeyLimits) : null;
  } catch {
    return null;
  }
}

let snapshot: KeyLimits | null = load();

const num = (v: string | null): number | undefined => {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Capture rate-limit info from an AI response's `x-ratelimit-*` headers, *if the server exposes
 * them to the browser* (`Access-Control-Expose-Headers`). Many providers don't — then nothing is
 * readable and we simply keep the last snapshot (the Settings display stays hidden). Best-effort.
 */
export function recordKeyLimits(headers: Headers, provider: string): void {
  const g = (h: string) => headers.get(h);
  const limitRequests = num(g('x-ratelimit-limit-requests'));
  const remainingRequests = num(g('x-ratelimit-remaining-requests'));
  const limitTokens = num(g('x-ratelimit-limit-tokens'));
  const remainingTokens = num(g('x-ratelimit-remaining-tokens'));
  if (
    limitRequests === undefined &&
    remainingRequests === undefined &&
    limitTokens === undefined &&
    remainingTokens === undefined
  ) {
    return; // headers not exposed — nothing to show
  }
  snapshot = {
    provider,
    limitRequests,
    remainingRequests,
    limitTokens,
    remainingTokens,
    resetRequests: g('x-ratelimit-reset-requests') ?? undefined,
    resetTokens: g('x-ratelimit-reset-tokens') ?? undefined,
    at: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage failures
  }
  emit();
}

export function getKeyLimits(): KeyLimits | null {
  return snapshot;
}

export function subscribeKeyLimits(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
