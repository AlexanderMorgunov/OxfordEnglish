import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db/db';
import type { SrsCard } from '@/db/db';
import {
  captureDataScope,
  requireDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { isDeleted } from '@/features/sync/resolve';
import { mutateSrsCard } from '@/features/sync/local';
import { reviewableCards } from './service';

export type ReviewData = {
  cards: SrsCard[];
  due: SrsCard[];
  errors: number;
  nextDue: Date | null;
};

export async function readReviewData(now = new Date()): Promise<ReviewData> {
  const current = captureDataScope();
  const [rows, statuses] = await Promise.all([
    db.srsCards.toArray(),
    db.wordStatus.where('status').equals('ignored').toArray(),
  ]);
  requireDataScope(current);
  const cards = reviewableCards(
    rows,
    new Set(statuses.map((row) => row.word.toLowerCase()))
  ).sort(
    (a, b) => a.due.getTime() - b.due.getTime() || a.id.localeCompare(b.id)
  );
  return {
    cards,
    due: cards.filter((card) => card.due <= now),
    errors: cards.filter((card) => card.fromError).length,
    nextDue: cards.find((card) => card.due > now)?.due ?? null,
  };
}

export function useReviewData() {
  const [attempt, setAttempt] = useState(0),
    [cancelled, setCancelled] = useState(false);
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error' | 'cancelled';
    data: ReviewData | null;
  }>({ status: 'loading', data: null });
  useEffect(
    () =>
      subscribeDataScope(() => {
        setState({ status: 'loading', data: null });
        setCancelled(false);
        setAttempt((n) => n + 1);
      }),
    []
  );
  useEffect(() => {
    if (cancelled) return;
    const current = captureDataScope();
    let alive = true;
    setState((previous) =>
      previous.status === 'ready'
        ? previous
        : { ...previous, status: 'loading' }
    );
    const query = liveQuery(() => readReviewData()).subscribe({
      next: (data) => {
        if (alive && current()) setState({ status: 'ready', data });
      },
      error: () => {
        if (alive && current())
          setState((previous) => ({ ...previous, status: 'error' }));
      },
    });
    const refresh = () => setAttempt((n) => n + 1);
    const timer = setInterval(refresh, 60000);
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      query.unsubscribe();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [attempt, cancelled]);
  return {
    ...state,
    retry: () => {
      setCancelled(false);
      setAttempt((n) => n + 1);
    },
    cancel: () => {
      setCancelled(true);
      setState((previous) => ({ ...previous, status: 'cancelled' }));
    },
  };
}

export async function removeLegacyCards(
  ids: string[],
  current = captureDataScope()
): Promise<string[]> {
  return db.transaction(
    'rw',
    [
      db.srsCards,
      db.pending,
      db.wordStatus,
      db.reviewLog,
      db.translations,
      db.syncState,
    ],
    async () => {
      const removed: string[] = [];
      for (const id of new Set(ids)) {
        requireDataScope(current);
        const saved = await mutateSrsCard(
          id,
          (row) =>
            row.fromError && !isDeleted(row)
              ? {
                  ...row,
                  deletedAt: Math.max(Date.now(), row.updatedAt ?? 0) + 1,
                }
              : undefined,
          current
        );
        if (saved) removed.push(id);
      }
      requireDataScope(current);
      return removed;
    }
  );
}
