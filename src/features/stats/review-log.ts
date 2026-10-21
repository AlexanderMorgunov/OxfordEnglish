import type { ReviewLogEntry } from '@/db/db';

export function mergeReviewLog(local: ReviewLogEntry | undefined, incoming: ReviewLogEntry): ReviewLogEntry {
  if (!incoming || typeof incoming.id !== 'string' || !incoming.id || typeof incoming.cardId !== 'string'
    || !incoming.cardId || !Number.isInteger(incoming.rating) || incoming.rating < 0 || incoming.rating > 4
    || !Number.isFinite(incoming.ts) || incoming.ts < 0
    || (incoming.modifiedAt !== undefined && (!Number.isFinite(incoming.modifiedAt) || incoming.modifiedAt < incoming.ts))) {
    throw new Error('Invalid review history');
  }
  if (!local) return incoming;
  if (local.cardId !== incoming.cardId || local.ts !== incoming.ts) return local;
  return (incoming.modifiedAt ?? incoming.ts) > (local.modifiedAt ?? local.ts) ? incoming : local;
}
