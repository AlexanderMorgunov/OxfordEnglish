import { useSyncExternalStore } from 'react';
import {
  getDataScopeRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { ProgressDashboard } from '@/features/progress/ProgressDashboard';
import { GameProgress } from '@/features/games/GameProgress';
import { useGameAvailability } from '@/features/games/availability';

export function ProgressPage() {
  const gamesAllowed = useGameAvailability((state) => state.access === 'allowed');
  const scope = useSyncExternalStore(
    subscribeDataScope,
    getDataScopeRevision,
    getDataScopeRevision
  );
  return <><ProgressDashboard key={scope} />{gamesAllowed && <GameProgress key={`games-${scope}`} />}</>;
}
