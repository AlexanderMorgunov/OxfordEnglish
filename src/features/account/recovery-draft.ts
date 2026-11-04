import { createContext, use, useId, useLayoutEffect } from 'react';

export const RecoveryDraftContext = createContext<
  ((id: string, unsaved: boolean) => void) | null
>(null);

export function useRecoveryDraft(unsaved: boolean) {
  const update = use(RecoveryDraftContext);
  const id = useId();
  useLayoutEffect(() => {
    if (!unsaved || !update) return;
    update(id, true);
    return () => update(id, false);
  }, [id, unsaved, update]);
}
