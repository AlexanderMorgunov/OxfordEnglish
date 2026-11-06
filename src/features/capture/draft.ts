import { createContext, use, useId, useLayoutEffect } from 'react';

export const CaptureDraftContext = createContext<
  ((id: string, unsaved: boolean) => void) | null
>(null);
export function useCaptureDraft(unsaved: boolean) {
  const update = use(CaptureDraftContext);
  const id = useId();
  useLayoutEffect(() => {
    if (!update || !unsaved) return;
    update(id, true);
    return () => update(id, false);
  }, [id, unsaved, update]);
}
