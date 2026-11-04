import { useEffect, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { db } from '@/db/db';
import type { ExerciseAttempt } from '@/db/db';
import { getDueCards } from '@/features/srs/service';
import {
  captureDataScope,
  getDataScopeRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';

type ProgressRead = {
  revision: number;
  request: number;
  attempts: ExerciseAttempt[];
  due: number | null;
  error: boolean;
};
const EMPTY_ATTEMPTS: ExerciseAttempt[] = [];

export function useCourseProgress() {
  const revision = useSyncExternalStore(
    subscribeDataScope,
    getDataScopeRevision
  );
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<ProgressRead | null>(null);
  useEffect(() => {
    const current = captureDataScope();
    let alive = true;
    const timer = window.setTimeout(() => {
      if (alive && current())
        setResult({ attempts: [], due: null, revision, request, error: true });
    }, 8000);
    const subscription = liveQuery(async () => {
      const attempts = await db.attempts.toArray();
      const due = await getDueCards().then(
        (cards) => cards.length,
        () => null
      );
      return { attempts, due };
    }).subscribe({
      next: (value) => {
        window.clearTimeout(timer);
        if (alive && current())
          setResult({ ...value, revision, request, error: false });
      },
      error: () => {
        window.clearTimeout(timer);
        if (alive && current())
          setResult({
            attempts: [],
            due: null,
            revision,
            request,
            error: true,
          });
      },
    });
    return () => {
      alive = false;
      window.clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [revision, request]);
  const current =
    result?.revision === revision && result.request === request ? result : null;
  return {
    attempts: current?.attempts ?? EMPTY_ATTEMPTS,
    due: current?.due ?? null,
    status: !current
      ? ('loading' as const)
      : current.error
        ? ('error' as const)
        : ('ready' as const),
    retry: () => setRequest((value) => value + 1),
  };
}
