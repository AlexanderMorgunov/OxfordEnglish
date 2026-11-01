import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db/db';
import {
  captureDataScope,
  requireDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { isDeleted } from '@/features/sync/resolve';
import { buildLexicon } from './lexicon';
import type { LexiconEntry } from './lexicon';

export type VocabularyData = { entries: LexiconEntry[]; deleted: Set<string> };
export async function readVocabulary(): Promise<VocabularyData> {
  const current = captureDataScope();
  const [statuses, cards, translations] = await Promise.all([
    db.wordStatus.toArray(),
    db.srsCards.toArray(),
    db.translations.toArray(),
  ]);
  requireDataScope(current);
  return {
    entries: buildLexicon({ statuses, cards, translations }),
    deleted: new Set(
      cards
        .filter(
          (c) =>
            isDeleted(c) &&
            !c.fromError &&
            (c.kind === 'word' || c.kind === 'phrase')
        )
        .map((c) => c.front.toLowerCase())
    ),
  };
}

export function useVocabularyData() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error' | 'cancelled';
    data: VocabularyData | null;
  }>({ status: 'loading', data: null });
  const [cancelled, setCancelled] = useState(false);
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
    let active = true;
    const current = captureDataScope();
    setState({ status: 'loading', data: null });
    const query = liveQuery(readVocabulary).subscribe({
      next: (data) => {
        if (active && current()) setState({ status: 'ready', data });
      },
      error: () => {
        if (active && current()) setState({ status: 'error', data: null });
      },
    });
    return () => {
      active = false;
      query.unsubscribe();
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
      setState({ status: 'cancelled', data: null });
    },
  };
}
