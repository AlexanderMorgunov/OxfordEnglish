import { use, useEffect, useState, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useStore } from 'zustand';
import { captureDataScope, getDataScopeRevision, getDataOwnerRevision, subscribeDataScope } from '@/features/account/dataScope';
import type { ExerciseDraft } from '@/features/progress/sessionResults';
import { ExerciseSessionContext } from './session';

export function useExerciseState<K extends keyof ExerciseDraft>(
  id: string,
  key: K,
  initial: ExerciseDraft[K] | (() => ExerciseDraft[K]),
): [ExerciseDraft[K], Dispatch<SetStateAction<ExerciseDraft[K]>>] {
  const store = use(ExerciseSessionContext);
  const revision = useSyncExternalStore(subscribeDataScope, getDataScopeRevision);
  const value = useStore(store, state => state.scopeRevision === getDataOwnerRevision() ? state.drafts[id]?.[key] : undefined);
  const [fallback] = useState(initial);
  const owned = captureDataScope();

  useEffect(() => {
    store.getState().syncScope();
    if (store.getState().drafts[id]?.[key] === undefined) store.getState().setDraft(id, key, fallback);
  }, [store, id, key, fallback, value, revision]);

  const setValue: Dispatch<SetStateAction<ExerciseDraft[K]>> = next => {
    if (!owned()) return;
    store.getState().syncScope();
    const previous = store.getState().drafts[id]?.[key];
    store.getState().setDraft(id, key, typeof next === 'function'
      ? next(previous === undefined ? fallback : previous) : next);
  };
  return [value === undefined ? fallback : value, setValue];
}
