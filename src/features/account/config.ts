import { isNativePlatform } from '@/shared/lib/platform';

/**
 * Backend base URL, per environment (prod on main/dayenglish.ru, staging on dev/Vercel preview).
 * EMPTY BY DEFAULT — while empty, accounts are fully inert: the account UI is absent and no request is
 * ever made (mirrors the `ANALYTICS_ENDPOINT === ''` pattern). So the client can ship before the API is
 * live, and staging without an API isn't half-broken. Routes are versioned under `/v1`.
 */
export function accountApiBase(configured: string, location: Pick<Location, 'hostname' | 'protocol' | 'port'> | undefined, native: boolean): string {
  const base = configured.replace(/\/$/, '');
  // Vite proxies local web traffic; Capacitor's localhost must keep the real API URL.
  const localWeb = !native && location?.port && /^https?:$/.test(location.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return localWeb && /^https?:\/\//.test(base) ? `/__dayenglish_api/${encodeURIComponent(base)}` : base;
}

export const API_BASE = accountApiBase(import.meta.env.VITE_API_BASE ?? '', globalThis.location, isNativePlatform());

/** True only when a backend is configured — gates the whole account feature in the UI. */
export const accountsEnabled = (): boolean => API_BASE !== '';
