import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Entitlement } from './contract';
let owner = 0;
vi.mock('./store', () => ({
  captureAccountSessionOwner: () => {
    const captured = owner;
    return () => captured === owner;
  },
  useAccount: {
    getState: () => ({
      accountId: `account-${owner}`,
      sessionRevision: owner,
      status: 'authenticated',
      getAccessToken: async () => 'fixture-token',
    }),
  },
}));
vi.mock('./api', async (original) => ({
  ...(await original<object>()),
  getEntitlement: vi.fn(),
  claimTrial: vi.fn(),
}));
vi.mock('@/features/sync/meta', () => ({
  getInstallId: async () => 'fixture-install',
}));
vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));
import * as api from './api';
import { ApiFailure } from './api';
import { useEntitlement } from './entitlement';
import { useSignupTrial } from './useSignupTrial';
const free: Entitlement = {
  plan: 'free',
  active: false,
  ai: { used: 0, limit: 0 },
};
const trial: Entitlement = {
  plan: 'trial',
  active: true,
  trialEndsAt: Date.now() + 1209600000,
  ai: { used: 0, limit: 1000 },
};
beforeEach(() => {
  owner++;
  useEntitlement.getState().clear();
  vi.resetAllMocks();
  vi.mocked(api.getEntitlement).mockResolvedValue(free);
  vi.mocked(api.claimTrial).mockResolvedValue(trial);
});

test('combined registration activates once and repeated clicks share the ongoing work', async () => {
  let finish!: (plan: Entitlement) => void;
  vi.mocked(api.claimTrial).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result } = renderHook(useSignupTrial),
    done = vi.fn();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start(done);
  });
  await act(async () => {
    await result.current.retry();
  });
  expect(api.claimTrial).toHaveBeenCalledOnce();
  await act(async () => {
    finish(trial);
    await pending;
  });
  expect(done).toHaveBeenCalledExactlyOnceWith(trial);
});
test.each(['pro', 'trial'] as const)(
  'existing active %s is confirmed without a new claim or changed expiry',
  async (plan) => {
    const existing: Entitlement = {
      ...trial,
      plan,
      ...(plan === 'pro'
        ? { paidUntil: Date.now() + 2592000000 }
        : { trialEndsAt: Date.now() + 604800000 }),
    };
    vi.mocked(api.getEntitlement).mockResolvedValue(existing);
    const { result } = renderHook(useSignupTrial),
      done = vi.fn();
    await act(async () => {
      await result.current.start(done);
    });
    expect(api.claimTrial).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledExactlyOnceWith(existing);
  }
);
test('lost activation and read replies expose reconciliation, which does not claim again', async () => {
  vi.mocked(api.getEntitlement)
    .mockResolvedValueOnce(free)
    .mockRejectedValueOnce(new ApiFailure('network', 0))
    .mockResolvedValue(trial);
  vi.mocked(api.claimTrial).mockRejectedValue(new ApiFailure('network', 0));
  const { result } = renderHook(useSignupTrial),
    done = vi.fn();
  await act(async () => {
    await result.current.start(done);
  });
  expect(result.current.phase).toBe('uncertain');
  await act(async () => {
    await result.current.check();
  });
  expect(result.current.phase).toBe('complete');
  expect(done).toHaveBeenCalledOnce();
  expect(api.claimTrial).toHaveBeenCalledOnce();
});
test('failed activation can retry without extending a period or creating an account', async () => {
  vi.mocked(api.claimTrial)
    .mockRejectedValueOnce(new ApiFailure('billing_unavailable', 503))
    .mockResolvedValue(trial);
  const { result } = renderHook(useSignupTrial),
    done = vi.fn();
  await act(async () => {
    await result.current.start(done);
  });
  expect(result.current.phase).toBe('failed');
  await act(async () => {
    await result.current.retry();
  });
  expect(api.claimTrial).toHaveBeenCalledTimes(2);
  expect(done).toHaveBeenCalledExactlyOnceWith(trial);
});
test('used trial and device refusal remain a saved account without a completion', async () => {
  vi.mocked(api.claimTrial).mockRejectedValue(
    new ApiFailure('trial_already_claimed', 409)
  );
  const { result } = renderHook(useSignupTrial),
    done = vi.fn();
  await act(async () => {
    await result.current.start(done);
  });
  expect(result.current.phase).toBe('unavailable');
  expect(done).not.toHaveBeenCalled();
});
test('an unreadable plan never spends the one-time trial by guessing eligibility', async () => {
  vi.mocked(api.getEntitlement).mockRejectedValue(new ApiFailure('network', 0));
  const { result } = renderHook(useSignupTrial);
  await act(async () => {
    await result.current.start(vi.fn());
  });
  expect(result.current.phase).toBe('uncertain');
  expect(api.claimTrial).not.toHaveBeenCalled();
});
test('owner change and unmount prevent delayed activation result from navigating', async () => {
  let finish!: (plan: Entitlement) => void;
  vi.mocked(api.getEntitlement).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, unmount } = renderHook(useSignupTrial),
    done = vi.fn();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start(done);
  });
  owner++;
  unmount();
  await act(async () => {
    finish(free);
    await pending;
  });
  expect(api.claimTrial).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});

test('switching the owner while activation is pending suppresses its completion without an unmount', async () => {
  let finish!: (plan: Entitlement) => void;
  vi.mocked(api.claimTrial).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result } = renderHook(useSignupTrial),
    done = vi.fn();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start(done);
  });
  expect(api.claimTrial).toHaveBeenCalledOnce();
  owner++;
  await act(async () => {
    finish(trial);
    await pending;
  });
  expect(done).not.toHaveBeenCalled();
  expect(useEntitlement.getState().entitlement).toEqual(free);
});

test('restoring a pending trial after reload only reads and never repeats the claim', async () => {
  vi.mocked(api.getEntitlement).mockResolvedValue(trial);
  const { result } = renderHook(useSignupTrial),
    done = vi.fn();
  await act(async () => {
    await result.current.restore(done);
  });
  expect(result.current.phase).toBe('complete');
  expect(done).toHaveBeenCalledExactlyOnceWith(trial);
  expect(api.claimTrial).not.toHaveBeenCalled();
});
test('a pending trial with a confirmed free plan requires a separate explicit retry', async () => {
  const { result } = renderHook(useSignupTrial),
    done = vi.fn();
  await act(async () => {
    await result.current.restore(done);
  });
  expect(result.current.phase).toBe('failed');
  expect(api.claimTrial).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.retry();
  });
  expect(api.claimTrial).toHaveBeenCalledOnce();
  expect(done).toHaveBeenCalledExactlyOnceWith(trial);
});
