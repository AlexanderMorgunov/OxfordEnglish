import * as api from '@/features/account/api';
import { ApiFailure } from '@/features/account/api';
import { useAccount } from '@/features/account/store';
import { useEntitlement, managedAiAvailable, planUnreadable, hasManagedAi } from '@/features/account/entitlement';
import type { AiTaskRequest } from '@/features/account/contract';
import { isConfigured, useAiStore } from './store';
import { upsellTarget } from './upsell';
import type { AiConfig } from './provider';

/**
 * Picks the path for one AI call: the managed proxy (our key, paid/trial plans) or BYOK (the user's own
 * key, straight from the browser).
 *
 * Managed is preferred when available because it is the thing the subscription pays for. A managed
 * failure that the user could still route around — quota gone, proxy down, offline — falls back to BYOK
 * rather than surfacing, so a paying user with their own key never ends up worse off than a free one.
 */
export async function runTask(
  req: AiTaskRequest,
  config: AiConfig | null,
  byok: (config: AiConfig) => Promise<string>
): Promise<string> {
  // `planUnreadable` is in here deliberately: refusing locally when we simply have no answer is how a
  // subscriber on a bad connection got told to buy what they already own. Ask the proxy and let its
  // 401/402 be the refusal — it is the only party that actually knows.
  if (managedAiAvailable() || planUnreadable()) {
    try {
      const token = await useAccount.getState().getAccessToken();
      if (token) {
        const res = await api.aiComplete(token, req);
        useEntitlement.getState().applyUsage(res.ai);
        return res.content;
      }
    } catch (e) {
      // Re-read the plan so the UI stops offering a path the server just refused.
      if (e instanceof ApiFailure && (e.code === 'quota_exhausted' || e.code === 'no_plan')) {
        void useEntitlement.getState().load();
      }
      if (!isConfigured(config)) throw e;
    }
  }
  if (!isConfigured(config)) throw new Error('AI is not available');
  return byok(config);
}

/** Label for the LOCAL (Dexie/localStorage) cache key, standing in for the model id. The managed path
 *  pins its model server-side, so the client has no id to key on; 'managed' keeps its entries from
 *  colliding with a BYOK model's. Switching paths just costs one cache miss. */
export const aiPathLabel = (config: AiConfig | null): string =>
  managedAiAvailable() ? 'managed' : (config?.model ?? 'none');

/** Whether any AI path is usable — BYOK configured, or an active plan with quota. Components gate on
 *  this instead of on a BYOK key alone, or subscribers would see no AI at all. */
export const aiAvailable = (config: AiConfig | null): boolean => isConfigured(config) || managedAiAvailable();

/** Reactive form for components: re-renders when either the BYOK key or the plan changes, so the AI
 *  affordances appear the moment a trial is claimed and disappear when the quota runs out. */
export function useAiEnabled(): boolean {
  const config = useAiStore((s) => s.config);
  const entitlement = useEntitlement((s) => s.entitlement);
  return isConfigured(config) || hasManagedAi(entitlement);
}

/**
 * Reactive "we cannot tell": no key of their own, signed in, and no answer about the plan. A surface
 * that locks on `!useAiEnabled()` must check this too — the lock is a statement about the user's plan,
 * and this is exactly the state where we have no right to make one.
 */
export function useAiUnknown(): boolean {
  const config = useAiStore((s) => s.config);
  const status = useAccount((s) => s.status);
  const entitlement = useEntitlement((s) => s.entitlement);
  return !isConfigured(config) && upsellTarget(status, entitlement) === 'unknown';
}
