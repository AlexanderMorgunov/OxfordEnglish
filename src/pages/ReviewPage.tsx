import { useEffect, useState } from 'react';
import {
  getDataScopeRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { ReviewScreen } from '@/features/srs/ReviewScreen';

export function ReviewPage() {
  const [scope, setScope] = useState(getDataScopeRevision);
  useEffect(
    () => subscribeDataScope(() => setScope(getDataScopeRevision())),
    []
  );
  return <ReviewScreen key={scope} />;
}
