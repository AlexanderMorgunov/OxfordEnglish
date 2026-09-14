/**
 * Backend base URL, per environment (prod on main/dayenglish.ru, staging on dev/Vercel preview).
 * EMPTY BY DEFAULT — while empty, accounts are fully inert: the account UI is absent and no request is
 * ever made (mirrors the `ANALYTICS_ENDPOINT === ''` pattern). So the client can ship before the API is
 * live, and staging without an API isn't half-broken. Routes are versioned under `/v1`.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

/** True only when a backend is configured — gates the whole account feature in the UI. */
export const accountsEnabled = (): boolean => API_BASE !== '';
