/**
 * Analytics ingestion endpoint. EMPTY BY DEFAULT — while empty, analytics is fully inert:
 * nothing is stored, queued, or sent. Point it at a self-hosted collector (PostHog, Plausible,
 * or a tiny serverless function) once you have one, per the privacy-first plan (§14):
 * anonymous, no PII, offline-queued.
 *
 * The client POSTs a JSON batch:
 *   { anonId: string, firstSeen: number, events: { event, props?, ts }[] }
 * A 2xx response acknowledges receipt; the client then drops those events from its queue.
 */
export const ANALYTICS_ENDPOINT = '';
