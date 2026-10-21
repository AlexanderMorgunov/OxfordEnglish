import { PROVIDERS } from './provider';
import type { AiConfig } from './provider';
import { isConfigured } from './store';
import { managedAiAvailable, planUnreadable } from '@/features/account/entitlement';
import type { AiPath } from './route';

export async function cachePaths(config: AiConfig | null): Promise<{ path: AiPath; label: string }[]> {
  const managed = { path: 'managed' as const, label: 'v2 managed' };
  if (!isConfigured(config)) return [managed];
  const endpoint = (config.baseUrl || PROVIDERS[config.provider].baseUrl).replace(/\/$/, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([config.provider, endpoint, config.model])));
  const byok = { path: 'byok' as const, label: `v2 byok ${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}` };
  return managedAiAvailable() || planUnreadable() ? [managed, byok] : [byok, managed];
}
