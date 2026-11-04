import { useEffect, useRef, useState } from 'react';
import {
  accessOperation,
  accessOperationToken,
  accessReceipt,
} from './access-api';
import { ApiFailure } from './api';
import { captureAccountSessionOwner, useAccount } from './store';
import type { AccessRequest, AccessResult } from './access-contract';

type Pending = {
  request: AccessRequest;
  complete: (result: AccessResult) => void | Promise<void>;
  private: boolean;
};
const publicActions = new Set(['register', 'login', 'recover', 'reset']);

export function useAccessOperation(onOwnerChange: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<Pending | null>(null);
  const mounted = useRef(true);
  const owner = useRef(captureAccountSessionOwner());
  const adopting = useRef(false);
  const onOwnerChangeRef = useRef(onOwnerChange);
  onOwnerChangeRef.current = onOwnerChange;
  const session = useAccount((s) => s.sessionRevision);

  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      mounted.current = false;
      pending.current = null;
      setBusy(false);
      setUncertain(false);
    };
    const show = () => {
      mounted.current = true;
      if (!owner.current()) { setError('account_changed'); onOwnerChangeRef.current(); }
      owner.current = captureAccountSessionOwner();
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      mounted.current = false;
      pending.current = null;
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, []);
  useEffect(() => {
    const invalidate = () => {
      if (adopting.current || owner.current()) return;
      pending.current = null;
      owner.current = captureAccountSessionOwner();
      setBusy(false);
      setUncertain(false);
      setError('account_changed');
      onOwnerChangeRef.current();
    };
    invalidate();
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'oxford-account' || event.key === null) invalidate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [session]);

  const alive = () => mounted.current && owner.current();
  const deliver = async (result: AccessResult, operation: Pending) => {
    if (!alive() || pending.current !== operation) return;
    if (result.session) {
      adopting.current = true;
      try {
        owner.current = await useAccount
          .getState()
          .acceptAccessSession(
            result.session,
            result.action === 'register',
            alive
          );
      } finally {
        adopting.current = false;
      }
    }
    if (
      result.action === 'reset' &&
      result.accountId === useAccount.getState().accountId
    ) {
      adopting.current = true;
      try {
        await useAccount.getState().forgetAccessSession(alive);
        owner.current = captureAccountSessionOwner();
      } finally {
        adopting.current = false;
      }
    }
    if (!alive() || pending.current !== operation) return;
    await operation.complete(result);
    if (!alive() || pending.current !== operation) return;
    pending.current = null;
    setUncertain(false);
    setError('');
  };
  const invoke = async (operation: Pending, receipt: boolean) => {
    if (!alive()) return;
    setBusy(true);
    setError('');
    try {
      const token = operation.private
        ? await useAccount.getState().getAccessToken()
        : undefined;
      if (!alive()) return;
      if (operation.private && !token)
        throw new ApiFailure('unauthorized', 401);
      const result = receipt
        ? await accessReceipt(
            operation.request.operationToken,
            token ?? undefined
          )
        : await accessOperation(operation.request, token ?? undefined);
      await deliver(result, operation);
    } catch (failure) {
      if (!alive() || pending.current !== operation) return;
      const unknown =
        !(failure instanceof ApiFailure) ||
        failure.status === 0 ||
        failure.status >= 500 ||
        (receipt && failure.code === 'operation_unknown');
      if (unknown) {
        setUncertain(true);
        setError(
          receipt &&
            failure instanceof ApiFailure &&
            failure.code === 'operation_unknown'
            ? 'operation_unknown'
            : 'network'
        );
      } else {
        pending.current = null;
        setUncertain(false);
        setError(
          failure instanceof ApiFailure ? failure.code : 'access_unavailable'
        );
      }
    } finally {
      if (alive()) setBusy(false);
    }
  };
  const run = async (
    request: Omit<AccessRequest, 'operationToken'>,
    complete: Pending['complete']
  ) => {
    if (pending.current || !alive()) return;
    const operation = {
      request: { ...request, operationToken: accessOperationToken() },
      complete,
      private: !publicActions.has(request.action),
    };
    pending.current = operation;
    await invoke(operation, false);
  };
  const reconcile = () =>
    pending.current ? invoke(pending.current, true) : Promise.resolve();
  const retrySame = () =>
    pending.current ? invoke(pending.current, false) : Promise.resolve();
  return {
    run,
    reconcile,
    retrySame,
    busy,
    error,
    uncertain,
    clearError: () => setError(''),
    alive,
    adoptOwner: () => {
      owner.current = captureAccountSessionOwner();
    },
  };
}
