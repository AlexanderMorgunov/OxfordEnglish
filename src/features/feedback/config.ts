/**
 * Feedback transport, empty by default. The in-app form works regardless — it queues to a local
 * outbox — but nothing is delivered until one of these is set. Pluggable, like the analytics
 * endpoint: the form doesn't care what's behind it.
 *
 * Priority order: FEEDBACK_ENDPOINT (our own server) → Web3Forms (no-backend interim) → mailto.
 */

/** Our own endpoint once a server exists (a Cloudflare Worker). Takes precedence when set. */
export const FEEDBACK_ENDPOINT = '';

/** Free access key from web3forms.com — no submitter account, static-site POST. Interim transport. */
export const WEB3FORMS_ACCESS_KEY = '';

/** Optional address for the "or email us" fallback link. Empty → no mailto shown. */
export const FEEDBACK_EMAIL = '';
