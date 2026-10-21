import * as api from '@/features/account/api';
import { ApiFailure } from '@/features/account/api';
import { useAccount } from '@/features/account/store';
import { useEntitlement, managedAiAvailable, planUnreadable, hasManagedAi } from '@/features/account/entitlement';
import type { AiTaskRequest } from '@/features/account/contract';
import { isConfigured, useAiStore } from './store';
import { upsellTarget } from './upsell';
import type { AiConfig } from './provider';
import { captureDataScope, requireDataScope, subscribeDataScope } from '@/features/account/dataScope';
import { abortReason, withDeadline } from '@/shared/lib/deadline';

export type AiPath = 'managed' | 'byok';
export type AiResult = { content: string; path: AiPath };
export const AI_AUTH_TIMEOUT = 8000;
export const AI_ATTEMPT_TIMEOUT = 25000;
export const AI_REQUEST_TIMEOUT = AI_AUTH_TIMEOUT + 2 * AI_ATTEMPT_TIMEOUT;
type Options = { signal?: AbortSignal; path?: AiPath };
type Byok = (config: AiConfig, signal: AbortSignal) => Promise<string>;

export function captureAiScope(signal?: AbortSignal): () => void {
  const current = captureDataScope();
  const initial = useAiStore.getState().config;
  const account = useAccount.getState();
  return () => {
    requireDataScope(current);
    const now = useAccount.getState();
    if (initial !== useAiStore.getState().config || account.sessionRevision !== now.sessionRevision || account.accountId !== now.accountId || account.status !== now.status) {
      throw new DOMException('AI settings or account changed', 'AbortError');
    }
    if (signal?.aborted) throw abortReason(signal);
  };
}

function canFallback(error: unknown): boolean {
  if (error instanceof ApiFailure) {
    return error.status === 0 || error.status >= 500 || [401, 402, 429].includes(error.status);
  }
  return error instanceof TypeError || ((error instanceof Error || error instanceof DOMException) && error.name === 'TimeoutError');
}

export async function runTaskResult(req: AiTaskRequest, config: AiConfig | null, byok: Byok, opts: Options = {}): Promise<AiResult> {
  const requireActive = captureAiScope(opts.signal);
  const controller = new AbortController();
  const abort = () => controller.abort(opts.signal?.reason);
  const changed = () => {
    try { requireActive(); } catch (error) { controller.abort(error); }
  };
  const cleanup = [subscribeDataScope(changed), useAiStore.subscribe(changed), useAccount.subscribe(changed)];
  opts.signal?.addEventListener('abort', abort, { once: true });
  try {
    requireActive();
    if (opts.path === 'managed' || (!opts.path && (managedAiAvailable() || planUnreadable()))) {
      try {
        // Stop waiting without aborting the shared, rotating authentication refresh.
        const token = await withDeadline(AI_AUTH_TIMEOUT, controller.signal, () => useAccount.getState().getAccessToken());
        requireActive();
        if (!token) throw new ApiFailure('network', 0);
        const res = await withDeadline(AI_ATTEMPT_TIMEOUT, controller.signal, signal => api.aiComplete(token, req, signal));
        requireActive();
        useEntitlement.getState().applyUsage(res.ai);
        return { content: res.content, path: 'managed' };
      } catch (error) {
        requireActive();
        if (error instanceof ApiFailure && ['quota_exhausted', 'no_plan'].includes(error.code)) void useEntitlement.getState().load();
        if (!isConfigured(config) || !canFallback(error)) throw error;
      }
    }
    if (!isConfigured(config)) throw new Error('AI is not available');
    requireActive();
    const content = await withDeadline(AI_ATTEMPT_TIMEOUT, controller.signal, signal => byok(config, signal));
    requireActive();
    return { content, path: 'byok' };
  } finally {
    opts.signal?.removeEventListener('abort', abort);
    cleanup.forEach(unsubscribe => unsubscribe());
  }
}

export async function runTask(req: AiTaskRequest, config: AiConfig | null, byok: Byok, opts: Options = {}): Promise<string> {
  return (await runTaskResult(req, config, byok, opts)).content;
}

export const aiPathLabel = (config: AiConfig | null): string =>
  managedAiAvailable() || planUnreadable() ? 'managed' : (config?.model ?? 'none');

export const aiAvailable = (config: AiConfig | null): boolean => isConfigured(config) || managedAiAvailable() || planUnreadable();

export function useAiEnabled(): boolean {
  const config = useAiStore(s => s.config);
  const entitlement = useEntitlement(s => s.entitlement);
  const status = useAccount(s => s.status);
  return isConfigured(config) || hasManagedAi(entitlement) || (status === 'authenticated' && entitlement === null);
}

export function useAiUnknown(): boolean {
  const config = useAiStore(s => s.config);
  const status = useAccount(s => s.status);
  const entitlement = useEntitlement(s => s.entitlement);
  return !isConfigured(config) && upsellTarget(status, entitlement) === 'unknown';
}
