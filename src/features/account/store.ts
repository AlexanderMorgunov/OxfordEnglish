import { create } from 'zustand';
import { accountsEnabled } from './config';
import { deriveCredentials, generateRecoveryKey } from './keys';
import * as api from './api';
import { ApiFailure } from './api';
import { db } from '@/db/db';
import { wipeSyncedData } from '@/features/sync/engine';
import type { Device, DeviceStartResponse, Session } from './contract';

const KEY = 'oxford-account';

/** Persisted across launches. Access token is deliberately NOT persisted — it lives in memory and is
 *  re-minted by a silent refresh on app open (session survives via the refresh token). */
type Persisted = { accountId: string; deviceId: string; refreshToken: string };

/** A stable, non-PII device label for the revoke list (e.g. "Chrome · Android"). Best-effort. */
function deviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = /Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function load(): Persisted | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

function save(p: Persisted | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    // ignore storage failures
  }
}

/** Adopting a session for a DIFFERENT account than the one stored = an account switch. Wipe the previous
 *  account's synced rows before adopting, so A's data never merges into B on the next reconcile (H5). */
async function maybeSwitchWipe(newAccountId: string): Promise<void> {
  const prev = load()?.accountId;
  if (prev && prev !== newAccountId) await wipeSyncedData().catch(() => undefined);
}

/** A device id is minted once and reused, so the same physical device keeps one entry in the device list. */
function ensureDeviceId(): string {
  const existing = load();
  if (existing?.deviceId) return existing.deviceId;
  const id = randomId();
  save({ accountId: existing?.accountId ?? '', deviceId: id, refreshToken: existing?.refreshToken ?? '' });
  return id;
}

type Status = 'anonymous' | 'authenticated';

type AccountState = {
  status: Status;
  accountId: string | null;
  deviceId: string;
  accessToken: string | null;
  accessExpiresAt: number;
  busy: boolean;
  error: string | null;
  /** Create a brand-new account; returns the recovery key to show on the save-your-key screen. */
  createAccount: () => Promise<string>;
  /** Link this device to an existing account by its recovery key. */
  linkWithKey: (recoveryKey: string) => Promise<void>;
  /** Silent refresh (single-flight across concurrent callers and, where supported, across tabs). */
  refresh: () => Promise<void>;
  /** A valid access token, refreshing first if it is missing/expired. Null when not authenticated. */
  getAccessToken: () => Promise<string | null>;
  logout: () => Promise<void>;

  // --- Device linking by approval ---
  /** New device: start a link request; returns the code + requestId to show and poll on. */
  startDeviceLink: () => Promise<DeviceStartResponse>;
  /** New device: poll a request once; on approval adopts the session (this device becomes signed in). */
  pollDeviceLink: (requestId: string) => Promise<'pending' | 'approved' | 'expired'>;
  /** Authed device: approve a pending request by its code; returns the new device's name. */
  approveDevice: (code: string) => Promise<string | undefined>;
  /** List this account's devices (for the revoke UI). */
  listDevices: () => Promise<Device[]>;
  /** Revoke another device by id. */
  revokeDevice: (deviceId: string) => Promise<void>;
  /** Permanently delete the account server-side, then drop to anonymous + wipe local synced data. */
  deleteAccount: () => Promise<void>;
};

/** Shared across all concurrent refresh callers in this tab, so a burst never sends the refresh token
 *  twice (which reuse-detection would read as theft and revoke the family — see design H4). */
let refreshInFlight: Promise<void> | null = null;

export const useAccount = create<AccountState>((set, get) => {
  const persisted = load();
  const deviceId = ensureDeviceId();

  const applySession = (s: Session) => {
    save({ accountId: s.accountId, deviceId: s.deviceId, refreshToken: s.refreshToken });
    set({
      status: 'authenticated',
      accountId: s.accountId,
      deviceId: s.deviceId,
      accessToken: s.accessToken,
      accessExpiresAt: s.accessExpiresAt,
      error: null,
    });
  };

  const clearSession = () => {
    save(null);
    // Keep the deviceId so relinking reuses the same device entry.
    save({ accountId: '', deviceId, refreshToken: '' });
    set({ status: 'anonymous', accountId: null, accessToken: null, accessExpiresAt: 0 });
  };

  return {
    status: persisted?.refreshToken ? 'authenticated' : 'anonymous',
    accountId: persisted?.accountId || null,
    deviceId,
    accessToken: null,
    accessExpiresAt: 0,
    busy: false,
    error: null,

    createAccount: async () => {
      if (!accountsEnabled()) throw new Error('accounts disabled');
      set({ busy: true, error: null });
      try {
        const recoveryKey = generateRecoveryKey();
        const creds = await deriveCredentials(recoveryKey);
        const session = await api.register({ ...creds, deviceName: deviceName() });
        await maybeSwitchWipe(session.accountId);
        applySession(session);
        return recoveryKey;
      } catch (e) {
        set({ error: e instanceof ApiFailure ? e.code : 'error' });
        throw e;
      } finally {
        set({ busy: false });
      }
    },

    linkWithKey: async (recoveryKey) => {
      if (!accountsEnabled()) throw new Error('accounts disabled');
      set({ busy: true, error: null });
      try {
        const creds = await deriveCredentials(recoveryKey.trim());
        const session = await api.login({ ...creds, deviceName: deviceName() });
        await maybeSwitchWipe(session.accountId);
        applySession(session);
      } catch (e) {
        set({ error: e instanceof ApiFailure ? e.code : 'error' });
        throw e;
      } finally {
        set({ busy: false });
      }
    },

    refresh: async () => {
      const token = load()?.refreshToken;
      if (!token) return;
      if (refreshInFlight) return refreshInFlight;
      const run = async () => {
        try {
          const session = await api.refresh(token);
          applySession(session);
        } catch (e) {
          // A reused/invalid refresh means the family is gone — drop to anonymous (local data stays).
          if (e instanceof ApiFailure && (e.code === 'refresh_reused' || e.code === 'refresh_invalid')) {
            clearSession();
          }
          // Network errors: keep the session; a later refresh retries.
        } finally {
          refreshInFlight = null;
        }
      };
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      refreshInFlight = locks
        ? locks.request('account-refresh', run).then(() => undefined)
        : run();
      return refreshInFlight;
    },

    getAccessToken: async () => {
      if (get().status !== 'authenticated') return null;
      const { accessToken, accessExpiresAt } = get();
      if (accessToken && Date.now() < accessExpiresAt - 30_000) return accessToken;
      await get().refresh();
      return get().accessToken;
    },

    logout: async () => {
      const token = load()?.refreshToken;
      if (token) await api.logout(token).catch(() => undefined);
      clearSession();
      // Wipe only when nothing is unsynced — an OFFLINE logout keeps local data so unpushed progress
      // isn't lost (it re-syncs on the next login to the same account). Switching to a DIFFERENT account
      // is handled by maybeSwitchWipe on adopt, so contamination is covered either way (H5).
      try {
        if ((await db.pending.count()) === 0) await wipeSyncedData();
      } catch {
        // best-effort
      }
    },

    startDeviceLink: () => api.deviceStart(deviceName()),

    pollDeviceLink: async (requestId) => {
      const res = await api.devicePoll(requestId);
      if (res.status === 'approved' && res.session) {
        await maybeSwitchWipe(res.session.accountId);
        applySession(res.session);
      }
      return res.status;
    },

    approveDevice: async (code) => {
      const token = await get().getAccessToken();
      if (!token) throw new ApiFailure('unauthorized', 401);
      const res = await api.deviceApprove(token, code.trim());
      return res.deviceName;
    },

    listDevices: async () => {
      const token = await get().getAccessToken();
      if (!token) return [];
      return api.listDevices(token);
    },

    revokeDevice: async (targetDeviceId) => {
      const token = await get().getAccessToken();
      if (!token) throw new ApiFailure('unauthorized', 401);
      await api.deviceRevoke(token, targetDeviceId);
    },

    deleteAccount: async () => {
      const token = await get().getAccessToken();
      if (token) await api.deleteAccount(token);
      clearSession();
      await wipeSyncedData().catch(() => undefined); // remove the now-orphaned local copy too
    },
  };
});
