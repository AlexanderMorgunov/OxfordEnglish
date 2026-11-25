import { createContext, use, useEffect, useId } from 'react';
import type { Blocker } from 'react-router-dom';

const idle: Blocker = {
  state: 'unblocked',
  proceed: undefined,
  reset: undefined,
  location: undefined,
};
export const ActivityNavigationContext = createContext<{
  register: (id: string, active: boolean) => void;
  blocker: Blocker;
} | null>(null);

export function useActivityNavigationGuard(active: boolean): Blocker {
  const context = use(ActivityNavigationContext);
  if (!context)
    throw new Error('Activity navigation requires the app navigation guard');
  const { register, blocker } = context;
  const id = useId();
  useEffect(() => {
    register(id, active);
    return () => register(id, false);
  }, [id, active, register]);
  return active ? blocker : idle;
}
export { idle as idleNavigationBlocker };
