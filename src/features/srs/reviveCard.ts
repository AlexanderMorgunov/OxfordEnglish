import type { SrsCard } from '@/db/db';

/** FSRS cards carry Date fields that JSON flattens to strings — revive them. Shared by backup restore,
 *  the .online migration, and the sync engine (applying pulled cards), so it lives in a neutral module. */
export function reviveCard(row: SrsCard): SrsCard {
  const card = row.card as SrsCard['card'] & { last_review?: string | Date };
  return {
    ...row,
    due: new Date(row.due),
    card: {
      ...card,
      due: new Date(card.due),
      last_review: card.last_review ? new Date(card.last_review) : undefined,
    },
  };
}
