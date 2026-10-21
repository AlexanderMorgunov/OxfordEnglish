import { isNativePlatform } from '@/shared/lib/platform';

const KEY = 'oxford-page-diagnostics';
const LIMIT = 10;
const MAX_BYTES = 8192;
const NAMES = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'SecurityError', 'QuotaExceededError', 'Unknown'] as const;
const ROUTES = ['/', '/about', '/placement', '/course/:unitId/day/:dayId', '/grammar', '/grammar/:articleId', '/review', '/checkpoint/:unitId', '/progress', '/vocabulary', '/vocabulary/text', '/library', '/library/catalog/:catalogId', '/library/:bookId', '/settings', '/support', '/credits', '/feedback', '/privacy', '/terms', '/pro', '/billing/success', '/billing/fail', '/unknown'] as const;

export type PageDiagnostic = {
  kind: 'page_load' | 'page_render';
  name: typeof NAMES[number];
  route: typeof ROUTES[number];
  time: number;
  version: string;
  build: string;
  platform: 'native' | 'web' | 'unknown';
};

export function safeErrorName(error: unknown): PageDiagnostic['name'] {
  try {
    const name: unknown = error instanceof Error ? error.name : undefined;
    return NAMES.find((value) => value === name) ?? 'Unknown';
  } catch {
    return 'Unknown';
  }
}

export class PageLoadError extends Error {
  readonly originalName: PageDiagnostic['name'];

  constructor(error: unknown) {
    super('Page code unavailable');
    this.name = 'PageLoadError';
    this.originalName = safeErrorName(error);
  }
}

export function isPageLoadError(error: unknown): error is PageLoadError {
  try {
    return error instanceof PageLoadError;
  } catch {
    return false;
  }
}

function routeTemplate(path: string): PageDiagnostic['route'] {
  const plain = path.split(/[?#]/, 1)[0]?.replace(/\/+$/, '') || '/';
  const exact = ROUTES.find((route) => !route.includes(':') && route === plain);
  if (exact) return exact;
  if (/^\/course\/[^/]+\/day\/[^/]+$/.test(plain)) return '/course/:unitId/day/:dayId';
  if (/^\/grammar\/[^/]+$/.test(plain)) return '/grammar/:articleId';
  if (/^\/checkpoint\/[^/]+$/.test(plain)) return '/checkpoint/:unitId';
  if (/^\/library\/catalog\/[^/]+$/.test(plain)) return '/library/catalog/:catalogId';
  if (/^\/library\/[^/]+$/.test(plain)) return '/library/:bookId';
  return '/unknown';
}

function readDiagnostic(value: unknown): PageDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const name = NAMES.find((name) => name === row.name);
  const route = ROUTES.find((route) => route === row.route);
  if (!name || !route || (row.kind !== 'page_load' && row.kind !== 'page_render') ||
      (row.platform !== 'native' && row.platform !== 'web' && row.platform !== 'unknown') ||
      typeof row.time !== 'number' || !Number.isFinite(row.time) || row.time < 0 ||
      typeof row.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]{1,32})?$/.test(row.version) ||
      typeof row.build !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.build)) return null;
  return { kind: row.kind, name, route, platform: row.platform, time: row.time, version: row.version, build: row.build };
}

export function pageDiagnostics(): PageDiagnostic[] {
  try {
    const raw = localStorage.getItem(KEY) ?? '[]';
    if (raw.length > MAX_BYTES || new TextEncoder().encode(raw).byteLength > MAX_BYTES) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.slice(-LIMIT).flatMap((value) => {
      const row = readDiagnostic(value);
      return row ? [row] : [];
    });
  } catch {
    return [];
  }
}

export function recordPageError(error: unknown, pathname = '/unknown'): PageDiagnostic {
  let platform: PageDiagnostic['platform'] = 'unknown';
  try {
    platform = isNativePlatform() ? 'native' : 'web';
  } catch {
    // Optional host capabilities must not break the error fallback.
  }
  const event: PageDiagnostic = {
    kind: isPageLoadError(error) ? 'page_load' : 'page_render',
    name: safeErrorName(error),
    route: routeTemplate(pathname), time: Date.now(), version: __APP_VERSION__, build: __APP_BUILD__, platform,
  };
  try {
    if (isPageLoadError(error)) event.name = NAMES.find((name) => name === error.originalName) ?? 'Unknown';
  } catch {
    event.name = 'Unknown';
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([...pageDiagnostics(), event].slice(-LIMIT)));
  } catch {
    // The current sanitized record is still available without persistent storage.
  }
  return event;
}
