import { useCallback, useEffect, useRef, useState } from 'react';

export type ProgressResource<T> = {
  status: 'loading' | 'ready' | 'error' | 'cancelled';
  data: T | null;
  retry: () => void;
  cancel: () => void;
};

export function useProgressResource<T>(
  load: () => Promise<T>
): ProgressResource<T> {
  const request = useRef(0);
  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  const [state, setState] = useState<
    Pick<ProgressResource<T>, 'status' | 'data'>
  >({ status: 'loading', data: null });
  const retry = useCallback(() => {
    const id = ++request.current;
    setState({ status: 'loading', data: null });
    void Promise.resolve()
      .then(load)
      .then(
        (data) => {
          if (id === request.current) setState({ status: 'ready', data });
        },
        () => {
          if (id === request.current) setState({ status: 'error', data: null });
        }
      );
  }, [load]);
  const cancel = useCallback(() => {
    request.current++;
    setState({ status: 'cancelled', data: null });
  }, []);
  useEffect(() => {
    retry();
    return invalidate;
  }, [retry, invalidate]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === 'visible') retry();
    };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [retry]);
  return { ...state, retry, cancel };
}
