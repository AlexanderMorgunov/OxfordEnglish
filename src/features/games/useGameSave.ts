import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { useAccount } from '@/features/account/store';
import { subscribeDataScope } from '@/features/account/dataScope';
import { gameScope, loadSave } from './storage';
import type { SavedGame } from './storage';

export function useGameSave(gameId: string) {
  const accountId = useAccount((s) => s.accountId);
  const sessionRevision = useAccount((s) => s.sessionRevision);
  const status = useAccount((s) => s.status);
  const [epoch, setEpoch] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    save: SavedGame | null;
    state: 'ready' | 'error';
  } | null>(null);
  const key = JSON.stringify([
    gameId,
    accountId,
    sessionRevision,
    status,
    epoch,
  ]);
  useEffect(() => subscribeDataScope(() => setEpoch((v) => v + 1)), []);
  useEffect(() => {
    const scope = gameScope();
    let active = true;
    const subscription = liveQuery(() =>
      loadSave(scope, gameId, '0')
    ).subscribe({
      next: (save) => {
        if (active) setResult({ key, save, state: 'ready' });
      },
      error: () => {
        if (active) setResult({ key, save: null, state: 'error' });
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [gameId, key]);
  return result?.key === key
    ? result
    : { save: null, state: 'loading' as const };
}
