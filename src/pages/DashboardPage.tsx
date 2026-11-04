import { useSyncExternalStore } from 'react';
import {
  getDataOwnerRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { CourseToday } from '@/features/course/CourseToday';

export function DashboardPage() {
  const owner = useSyncExternalStore(subscribeDataScope, getDataOwnerRevision);
  return <CourseToday key={owner} />;
}
