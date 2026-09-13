import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runTask, aiPathLabel, aiAvailable } from './route';
import { useEntitlement } from '@/features/account/entitlement';
import { useAccount } from '@/features/account/store';
import { ApiFailure } from '@/features/account/api';
import * as api from '@/features/account/api';
import type { AiConfig } from './provider';
import type { Entitlement } from '@/features/account/contract';
import type * as AccountApi from '@/features/account/api';

vi.mock('@/features/account/api', async (orig) => {
  const actual = await orig<typeof AccountApi>();
  return { ...actual, aiComplete: vi.fn() };
});

const BYOK: AiConfig = { provider: 'deepseek', apiKey: 'k', model: 'm' };
const PLAN = (over: Partial<Entitlement> = {}): Entitlement => ({
  plan: 'pro',
  active: true,
  ai: { used: 1, limit: 100 },
  ...over,
});

const setPlan = (e: Entitlement | null) => useEntitlement.setState({ entitlement: e });
const signIn = () =>
  useAccount.setState({ status: 'authenticated', getAccessToken: async () => 'tok' } as never);
const signOut = () =>
  useAccount.setState({ status: 'anonymous', getAccessToken: async () => null } as never);

beforeEach(() => {
  vi.mocked(api.aiComplete).mockReset();
  setPlan(null);
  signOut();
});

describe('runTask', () => {
  it('uses the managed path when a plan has quota, without touching BYOK', async () => {
    setPlan(PLAN());
    signIn();
    vi.mocked(api.aiComplete).mockResolvedValue({ content: 'managed', cached: false, ai: { used: 2, limit: 100 } });
    const byok = vi.fn();

    expect(await runTask({ task: 'translate', text: 'x' }, BYOK, byok)).toBe('managed');
    expect(byok).not.toHaveBeenCalled();
  });

  it('records the quota the server reports, so the counter moves without a refetch', async () => {
    setPlan(PLAN());
    signIn();
    vi.mocked(api.aiComplete).mockResolvedValue({ content: 'ok', cached: true, ai: { used: 7, limit: 100 } });

    await runTask({ task: 'translate', text: 'x' }, BYOK, vi.fn());
    expect(useEntitlement.getState().entitlement?.ai.used).toBe(7);
  });

  it('falls back to BYOK when the managed call fails — a paying user is never worse off', async () => {
    setPlan(PLAN());
    signIn();
    vi.mocked(api.aiComplete).mockRejectedValue(new ApiFailure('ai_unavailable', 503));

    expect(await runTask({ task: 'translate', text: 'x' }, BYOK, async () => 'byok')).toBe('byok');
  });

  it('surfaces the failure when there is no BYOK key to fall back to', async () => {
    setPlan(PLAN());
    signIn();
    vi.mocked(api.aiComplete).mockRejectedValue(new ApiFailure('quota_exhausted', 429));

    await expect(runTask({ task: 'translate', text: 'x' }, null, vi.fn())).rejects.toThrow();
  });

  it('goes straight to BYOK when the plan is exhausted', async () => {
    setPlan(PLAN({ ai: { used: 100, limit: 100 } }));
    signIn();

    expect(await runTask({ task: 'translate', text: 'x' }, BYOK, async () => 'byok')).toBe('byok');
    expect(api.aiComplete).not.toHaveBeenCalled();
  });

  it('goes straight to BYOK when the plan is inactive', async () => {
    setPlan(PLAN({ active: false, plan: 'free' }));
    signIn();

    expect(await runTask({ task: 'translate', text: 'x' }, BYOK, async () => 'byok')).toBe('byok');
    expect(api.aiComplete).not.toHaveBeenCalled();
  });

  it('throws when neither path is available', async () => {
    await expect(runTask({ task: 'translate', text: 'x' }, null, vi.fn())).rejects.toThrow(/not available/);
  });
});

describe('aiPathLabel / aiAvailable', () => {
  it('labels the two paths differently so their local caches never collide', () => {
    setPlan(PLAN());
    expect(aiPathLabel(BYOK)).toBe('managed');
    setPlan(null);
    expect(aiPathLabel(BYOK)).toBe('m');
  });

  it('treats an active plan as AI availability even with no BYOK key', () => {
    setPlan(PLAN());
    expect(aiAvailable(null)).toBe(true);
    setPlan(null);
    expect(aiAvailable(null)).toBe(false);
    expect(aiAvailable(BYOK)).toBe(true);
  });
});
