import { useSyncExternalStore } from 'react';
import {
  getDataScopeRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { ProgressDashboard } from '@/features/progress/ProgressDashboard';

export function ProgressPage() {
  const scope = useSyncExternalStore(
    subscribeDataScope,
    getDataScopeRevision,
    getDataScopeRevision
  );
  return <ProgressDashboard key={scope} />;
}
