import { create } from 'zustand';
import type { SrsCard } from '@/db/db';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import type { ReviewReceipt } from './service';

export type ReviewSession = {
  id: string;
  members: SrsCard[];
  receipts: ReviewReceipt[];
  skipped: string[];
  removed: string[];
  revealed: string[];
  tracked: boolean;
  current: () => boolean;
};
export const useReviewSession = create<{ session: ReviewSession | null }>(
  () => ({ session: null })
);
subscribeDataScope(() => useReviewSession.setState({ session: null }));

export function startReviewSession(cards: SrsCard[]) {
  useReviewSession.setState({
    session: {
      id: crypto.randomUUID(),
      members: cards,
      receipts: [],
      skipped: [],
      removed: [],
      revealed: [],
      tracked: false,
      current: captureDataScope(),
    },
  });
}
export function updateReviewSession(
  update: (session: ReviewSession) => ReviewSession
) {
  useReviewSession.setState((state) => ({
    session: state.session?.current() ? update(state.session) : null,
  }));
}
export function sessionCards(
  session: ReviewSession,
  due: SrsCard[]
): SrsCard[] {
  const members = new Map(
    session.members.map((card, index) => [card.id, { card, index }])
  );
  const finished = new Set([
    ...session.receipts.map((receipt) => receipt.after.id),
    ...session.removed,
  ]);
  return due
    .filter((card) => {
      const source = members.get(card.id)?.card;
      return (
        source &&
        source.creationId === card.creationId &&
        source.createdAt === card.createdAt &&
        !finished.has(card.id)
      );
    })
    .sort((a, b) => members.get(a.id)!.index - members.get(b.id)!.index);
}
