import { create } from 'zustand';
import { accountsEnabled } from './config';
import { deriveCredentials, deriveVerifier, formatCompositeKey, generateRecoveryKey } from './keys';
import * as api from './api';
import { ApiFailure } from './api';
import { db } from '@/db/db';
import { wipeSyncedData } from '@/features/sync/engine';
import type { Device, DeviceStartResponse, Session } from './contract';

const KEY = 'oxford-account';

/**
 * A recovery-by-name attempt whose answer was lost in transit.
 *
 * The server may or may not have installed `key` as the new credential, and there is no way to ask:
 * the account id lives only in the response we did not get. Both halves of that uncertainty are
 * resolved by sending the SAME key again with a fresh code, so the key has to survive the failure —
 * generating a second one on retry would guarantee that at most one of them is the real credential.
 */
export class PendingRecovery extends Error {
  constructor(readonly key: string) {
    super('recovery answer lost');
    this.name = 'PendingRecovery';
  }
}

/**
 * Where that key waits.
 *
 * It has to outlive the page, not just the component: the moment it is at risk is a dropped connection,
 * and "the connection dropped" and "the user reloaded, or the tab was closed" are the same minute. Held
 * only in React state it would be lost exactly when it is the sole copy of a credential the server may
 * already have installed.
 */
const PENDING_KEY = 'oxford-recovery-pending';

export function pendingRecoveryKey(): string | null {
  try {
    return localStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function stashPendingRecovery(key: string | null): void {
  try {
    if (key) localStorage.setItem(PENDING_KEY, key);
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore storage failures
  }
}

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

export type Status = 'anonymous' | 'authenticated';

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
  /** Link this device to an existing account by its recovery key (either shape — see keys.ts). */
  linkWithKey: (recoveryKey: string) => Promise<void>;
  /** Recover an account whose key is lost, using the authenticator. Returns the NEW composite credential
   *  the user must save — it is the only copy, and the old key is dead the moment this resolves. */
  recoverWithTotp: (accountId: string, code: string) => Promise<string>;
  /**
   * Recovery addressed by name. `pendingKey` is for the retry after a lost response — see the impl.
   */
  recoverWithName: (name: string, code: string, pendingKey?: string) => Promise<string>;
  /** Issue a new recovery key without signing out. Returns the credential to show, exactly once. */
  rotateRecoveryKey: (code: string, revokeOthers: boolean) => Promise<string>;
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
        const session = await api.register({ ...creds, deviceName: deviceName(), deviceId: get().deviceId });
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
        const session = await api.login({ ...creds, deviceName: deviceName(), deviceId: get().deviceId });
        await maybeSwitchWipe(session.accountId);
        applySession(session);
      } catch (e) {
        set({ error: e instanceof ApiFailure ? e.code : 'error' });
        throw e;
      } finally {
        set({ busy: false });
      }
    },

    /**
     * A new recovery key for someone who still has access.
     *
     * Deliberately NOT a new account id. A fresh key would derive a fresh id, and the id keys the blob
     * prefix, the entitlement row, the payment grant bindings, TOTP, devices and sync — and
     * `maybeSwitchWipe` would read the change as a different account and wipe local data. So the server
     * rebinds only the verifier and the composite is built from the id we already hold.
     */
    rotateRecoveryKey: async (code, revokeOthers) => {
      if (!accountsEnabled()) throw new Error('accounts disabled');
      const accountId = get().accountId;
      if (!accountId) throw new ApiFailure('unauthorized', 401);
      set({ busy: true, error: null });
      try {
        const newKey = generateRecoveryKey();
        const token = await get().getAccessToken();
        if (!token) throw new ApiFailure('unauthorized', 401);
        await api.totpRotateKey(token, { code: code.trim(), verifier: await deriveVerifier(newKey), revokeOthers });
        return formatCompositeKey(accountId, newKey);
      } catch (e) {
        set({ error: e instanceof ApiFailure ? e.code : 'error' });
        throw e;
      } finally {
        set({ busy: false });
      }
    },

    /**
     * Recover by the name the user chose, for the case the account id went with the key.
     *
     * Unlike `recoverWithTotp` there is no fallback for a lost response: that one logs in with
     * `<typed id>.<new key>`, and here the id is precisely what we do not have. So the new key is
     * handed back to the caller on a network failure instead, to be resubmitted with a FRESH code — the
     * rebind is idempotent, and a second attempt succeeds whether or not the first one landed. Throwing
     * a key away that the server may already have installed would close the account for good.
     */
    recoverWithName: async (name, code, pendingKey) => {
      if (!accountsEnabled()) throw new Error('accounts disabled');
      set({ busy: true, error: null });
      const newKey = pendingKey ?? generateRecoveryKey();
      try {
        const session = await api.totpRecoverByName({
          name: name.trim(),
          code: code.trim(),
          verifier: await deriveVerifier(newKey),
          deviceName: deviceName(),
        });
        await maybeSwitchWipe(session.accountId);
        applySession(session);
        stashPendingRecovery(null);
        return formatCompositeKey(session.accountId, newKey);
      } catch (e) {
        const failure = e instanceof ApiFailure ? e.code : 'error';
        set({ error: failure });
        if (failure !== 'network') throw e;
        stashPendingRecovery(newKey);
        throw new PendingRecovery(newKey);
      } finally {
        set({ busy: false });
      }
    },

    recoverWithTotp: async (accountId, code) => {
      if (!accountsEnabled()) throw new Error('accounts disabled');
      set({ busy: true, error: null });
      try {
        const newKey = generateRecoveryKey();
        const verifier = await deriveVerifier(newKey);
        let session;
        try {
          session = await api.totpRecover({ accountId: accountId.trim(), code: code.trim(), verifier, deviceName: deviceName() });
        } catch (e) {
          // The rebind may have landed with only the answer lost — and `newKey` exists nowhere but this
          // closure, while the OLD key is already dead on the server. Throwing here would close the
          // account for good. The new key either works as a credential or it does not, so ask.
          if (!(e instanceof ApiFailure) || e.code !== 'network') throw e;
          session = await api.login({
            ...(await deriveCredentials(formatCompositeKey(accountId.trim(), newKey))),
            deviceName: deviceName(),
            deviceId: get().deviceId,
          });
        }
        await maybeSwitchWipe(session.accountId);
        applySession(session);
        stashPendingRecovery(null);
        // The id comes from the SERVER's response, not the typed-in one: it is the id the credential must
        // carry, and echoing back what the user typed would bake a typo into their only way in.
        return formatCompositeKey(session.accountId, newKey);
      } catch (e) {
        set({ error: e instanceof ApiFailure ? e.code : 'error' });
        throw e;
      } finally {
        set({ busy: false });
      }
    },

    refresh: async () => {
      if (!load()?.refreshToken) return;
      if (refreshInFlight) return refreshInFlight;
      const run = async () => {
        try {
          // Read INSIDE the lock. Read outside it and a tab that queues behind another tab's rotation
          // sends the token that rotation just retired; the server reads a replayed token as theft and
          // revokes the whole family, dropping every tab to anonymous — with nothing actually stolen.
          const token = load()?.refreshToken;
          if (!token) return;
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
