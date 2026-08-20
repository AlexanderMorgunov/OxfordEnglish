/**
 * Feedback transport, read from build-time env so no key lands in a committed file. Set these in a
 * gitignored `.env` (see `.env.example`) or the host's build settings — NOT here in source.
 *
 * Note: whatever the client uses still ships in the built JS and is visible in the browser — a
 * no-backend PWA can't keep a transport secret. The Web3Forms key is public-by-design (identifies
 * an inbox, not a password); its only risk is spam, mitigated by Web3Forms' domain lock + Turnstile.
 * True server-side secrecy only comes with our own endpoint (a Worker), where the secret stays put.
 *
 * Priority order: FEEDBACK_ENDPOINT (our own server) → Web3Forms (no-backend interim) → mailto.
 */

/** Our own endpoint once a server exists (a Cloudflare Worker). Takes precedence when set. */
export const FEEDBACK_ENDPOINT = import.meta.env.VITE_FEEDBACK_ENDPOINT ?? '';

/** Free access key from web3forms.com — no submitter account, static-site POST. Interim transport. */
export const WEB3FORMS_ACCESS_KEY = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY ?? '';

/** Optional address for the "or email us" fallback link. Empty → no mailto shown. */
export const FEEDBACK_EMAIL = import.meta.env.VITE_FEEDBACK_EMAIL ?? '';
