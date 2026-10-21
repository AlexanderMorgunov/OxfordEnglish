import { create } from 'zustand';
import { accountsEnabled } from './config';
import { deriveCredentials, deriveVerifier, formatCompositeKey, generateRecoveryKey } from './keys';
import * as api from './api';
import { ApiFailure } from './api';
import { db } from '@/db/db';

import { releasePreviousAccountData, wipeSyncedData } from '@/features/sync/engine';
import { discardAllBookFiles } from '@/features/reader/storage';
import type { Device, DeviceStartResponse, Session } from './contract';
import { invalidateDataScope } from './dataScope';
import { recordSessionEvent } from './session-diagnostics';

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
type Persisted = {
  accountId: string;
  deviceId: string;
  refreshToken: string;
  /** Local session identity: adoption changes it, ordinary refresh rotation does not. */
  incarnation?: string;
  /**
   * Set while another account's rows are still on this device and the session that owned them is gone.
   * `accountId` answers "is the account signing in now a different one?" only while signed in; it is
   * blanked on logout, and that question is the only thing standing between account A's rows and account
   * B (H5). It means un-wiped data, NOT "this device once held an account" — a wipe that has already run
   * clears it, because after that the only thing left to destroy is work its owner did as an anonymous
   * user, which belongs to nobody.
   */
  lastAccountId?: string;
  /**
   * Who the book files in OPFS belong to. A SEPARATE question from `lastAccountId`, which is cleared as
   * soon as the wipe runs: the files deliberately survive a logout, because metadata syncs for everyone
   * while uploading the file is opt-in, so for a free-tier user the local copy is the only one and
   * signing back into the same account re-links it by id. They must go when a DIFFERENT account takes
   * the device — and by then the book rows are long gone, so the ids cannot be recovered. This is what
   * remembers that there is anything to release.
   */
  fileOwner?: string;
  /**
   * Who the unsynced LOCAL data belongs to — reading history, review log, and the account-scoped
   * settings mirrored in localStorage. Same question as `fileOwner`, different answer on one path: an
   * anonymous import releases the file marker, because deleting a book nobody can restore is worse than
   * keeping a stranger's. It must not release this one, where leaking is the harm.
   */
  dataOwner?: string;
};

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
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('accountId' in parsed) ||
      !('refreshToken' in parsed) || typeof parsed.accountId !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      ('deviceId' in parsed && typeof parsed.deviceId !== 'string')) {
      recordSessionEvent('storage_invalid');
      return null;
    }
    return { ...parsed, deviceId: 'deviceId' in parsed ? parsed.deviceId : '',
      incarnation: 'incarnation' in parsed && typeof parsed.incarnation === 'string' ? parsed.incarnation : undefined } as Persisted;
  } catch {
    recordSessionEvent('storage_read_failed');
    return null;
  }
}

function save(p: Persisted | null): void {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    recordSessionEvent('storage_write_failed');
  }
}

function sameSession(a: Persisted | null, b: Persisted | null): boolean {
  return a?.accountId === b?.accountId && a?.deviceId === b?.deviceId && a?.refreshToken === b?.refreshToken;
}

function sameLogicalSession(a: Persisted | null, b: Persisted | null): boolean {
  return a?.accountId === b?.accountId && a?.deviceId === b?.deviceId && a?.incarnation === b?.incarnation;
}

let authGeneration = 0;
let ownershipQueue = Promise.resolve();

/** Boolean ownership only; credential values and the local incarnation are never exposed. */
export function captureAccountSessionOwner(): () => boolean {
  const generation = authGeneration;
  const session = load();
  return () => generation === authGeneration && sameLogicalSession(session, load());
}

function withSessionOwnership<T>(run: () => Promise<T> | T): Promise<T> {
  const execute = () => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? locks.request('account-session', run) : run();
  };
  const next = ownershipQueue.then(execute, execute);
  ownershipQueue = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * Adopting a session for a DIFFERENT account than the one stored = an account switch. Wipe the previous
 * account's synced rows before adopting, so A's data never merges into B on the next reconcile (H5).
 *
 * Best-effort, and deliberately so: a failed wipe leaves A's rows AND A's dirty queue in place, which is
 * the contamination this exists to prevent. It is still the better half of the trade. Three of the five
 * callers mint the credential they are about to hand the user — `createAccount` returns the only copy of
 * the recovery key, and both recovery paths return a new key the server has ALREADY bound, killing the
 * old one. Throwing here would lose that key and close the account for good, trading a rare
 * contamination for a rare permanent account loss.
 */
async function maybeSwitchWipe(newAccountId: string): Promise<void> {
  const p = load();
  const prev = p?.accountId || p?.lastAccountId;
  if (prev && prev !== newAccountId) await wipeSyncedData().catch(() => undefined);
  // Asked separately from the wipe, because the answers differ: a clean logout clears the wipe marker
  // while both of these survive it. Each is claimed only once its own release actually ran, so a failure
  // is retried at the next sign-in.
  let fileOwner = p?.fileOwner;
  // Falls back to `lastAccountId` for installs that predate these markers: an app boot is
  // refresh() → applySession, so a device that is signed OUT at upgrade time never backfills, and the
  // one record that still names the previous tenant is the wipe marker. `fileOwner` deliberately does
  // NOT fall back — clearing it is how an anonymous import protects books that exist nowhere else, and
  // a fallback would re-arm it and delete exactly those. The cost is that such a device keeps the
  // previous account's books; that is the half where being wrong destroys rather than leaks.
  let dataOwner = p?.dataOwner ?? p?.lastAccountId;
  if (!dataOwner || dataOwner === newAccountId) dataOwner = newAccountId;
  else if (await ran(releasePreviousAccountData)) dataOwner = newAccountId;
  if (!fileOwner || fileOwner === newAccountId) fileOwner = newAccountId;
  else if (await ran(discardAllBookFiles)) fileOwner = newAccountId;
  setOwners(fileOwner, dataOwner);
}

async function ran(release: () => Promise<void>): Promise<boolean> {
  try {
    await release();
    return true;
  } catch {
    return false;
  }
}

/**
 * Importing a book while signed OUT means this device now holds files that belong to no account, so the
 * FILE marker must stop standing for all of them — that release is wholesale, and wholesale is only safe
 * while every file is the previous tenant's.
 *
 * `dataOwner` is deliberately untouched. The reading history and the account-scoped settings are the
 * half where leaving them behind is itself the harm, and an anonymous import says nothing about whose
 * they are.
 *
 * The cost is that the previous account's books survive a later sign-in by somebody else. That is the
 * right way round: keeping someone's book is a privacy cost, deleting the current user's only copy is
 * data loss, and "lost my key, made a new account" is an ordinary way to arrive here as the SAME
 * person. Per-file ownership would beat both; this is the honest version of a device-wide marker.
 */
export function forgetBookFileOwner(): void {
  const p = load();
  if (p && !p.refreshToken) save({ ...p, fileOwner: undefined });
}

function setOwners(fileOwner: string | undefined, dataOwner: string | undefined): void {
  const p = load();
  if (p) save({ ...p, fileOwner, dataOwner });
}

/** No SYNCED row of the previous account is left to protect the next one from. Unsynced local history
 *  outlives the wipe by design: `activity` and `reviewLog` are released at the account boundary instead
 *  (`releasePreviousAccountData`), while `translations` and `feedbackOutbox` still survive a handover —
 *  queue item 16. */
function forgetLastAccount(): void {
  const p = load();
  if (p) save({ ...p, lastAccountId: undefined });
}

/** A device id is minted once and reused, so the same physical device keeps one entry in the device list. */
function ensureDeviceId(): string {
  const existing = load();
  if (existing?.deviceId) return existing.deviceId;
  const id = randomId();
  save({ accountId: existing?.accountId ?? '', deviceId: id, refreshToken: existing?.refreshToken ?? '', incarnation: existing?.incarnation, lastAccountId: existing?.lastAccountId, fileOwner: existing?.fileOwner, dataOwner: existing?.dataOwner });
  return id;
}

export type Status = 'anonymous' | 'authenticated';

type AccountState = {
  status: Status;
  accountId: string | null;
  sessionRevision: number;
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
  /** Drop a failure that is no longer on screen. `error` otherwise survives until the next action, so
   *  a message from an abandoned attempt reappears beside an unrelated control. */
  clearError: () => void;
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
let refreshInFlight: { generation: number; session: Persisted; promise: Promise<void> } | null = null;

export const useAccount = create<AccountState>((set, get) => {
  const persisted = load();
  const deviceId = ensureDeviceId();
  recordSessionEvent(persisted?.refreshToken ? 'session_present' : 'session_absent');

  const applySession = (s: Session, refreshed = false) => {
    if (!refreshed) authGeneration += 1;
    if (get().accountId !== s.accountId) invalidateDataScope();
    save({ accountId: s.accountId, deviceId: s.deviceId, refreshToken: s.refreshToken,
      incarnation: refreshed ? load()?.incarnation : randomId(),
      // ?? on both: every install that is already signed in when this ships has neither marker, and an
      // app boot is refresh() → applySession without passing through maybeSwitchWipe. Left unarmed they
      // would never release anything. maybeSwitchWipe has already read the OLD values by now.
      fileOwner: load()?.fileOwner ?? s.accountId,
      dataOwner: load()?.dataOwner ?? s.accountId });
    set({
      status: 'authenticated',
      accountId: s.accountId,
      sessionRevision: authGeneration,
      deviceId: s.deviceId,
      accessToken: s.accessToken,
      accessExpiresAt: s.accessExpiresAt,
      busy: refreshed ? get().busy : false,
      error: null,
    });
    recordSessionEvent('authenticated');
  };

  const adoptSession = (s: Session) => withSessionOwnership(async () => {
    await maybeSwitchWipe(s.accountId);
    applySession(s);
  });

  const captureCredentialOwner = () => {
    const generation = authGeneration;
    const session = load();
    return () => generation === authGeneration && sameSession(session, load());
  };

  const captureLogicalSessionOwner = captureAccountSessionOwner;

  const prepareLogicalSessionOwner = () => {
    const generation = authGeneration;
    const invoking = load();
    return withSessionOwnership(() => {
      if (generation !== authGeneration || !sameLogicalSession(invoking, load())) return null;
      const existing = load();
      if (existing && !existing.incarnation) save({ ...existing, incarnation: randomId() });
      const session = load();
      return {
        current: captureLogicalSessionOwner(),
        refreshToken: session?.refreshToken,
      };
    });
  };

  const clearSession = () => {
    authGeneration += 1;
    const prev = load();
    save(null);
    // Keep the deviceId so relinking reuses the same device entry, and the account id so the next
    // sign-in can tell a re-login from a switch.
    save({ accountId: '', deviceId, refreshToken: '', incarnation: randomId(), lastAccountId: prev?.accountId || prev?.lastAccountId, fileOwner: prev?.fileOwner, dataOwner: prev?.dataOwner });
    set({ status: 'anonymous', accountId: null, sessionRevision: authGeneration, accessToken: null, accessExpiresAt: 0, busy: false });
  };

  return {
    status: persisted?.refreshToken ? 'authenticated' : 'anonymous',
    accountId: persisted?.accountId || null,
    sessionRevision: authGeneration,
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
        await adoptSession(session);
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
        await adoptSession(session);
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
      const generation = authGeneration;
      const accountId = get().accountId;
      const incarnation = load()?.incarnation;
      if (!accountId) throw new ApiFailure('unauthorized', 401);
      const ownsOperation = () => generation === authGeneration && get().accountId === accountId && incarnation === load()?.incarnation;
      set({ busy: true, error: null });
      try {
        const newKey = generateRecoveryKey();
        const token = await get().getAccessToken();
        if (!token || generation !== authGeneration || incarnation !== load()?.incarnation) throw new ApiFailure('unauthorized', 401);
        const verifier = await deriveVerifier(newKey);
        if (generation !== authGeneration || get().accountId !== accountId || incarnation !== load()?.incarnation) throw new ApiFailure('unauthorized', 401);
        await api.totpRotateKey(token, { code: code.trim(), verifier, revokeOthers });
        if (!ownsOperation()) throw new ApiFailure('unauthorized', 401);
        return formatCompositeKey(accountId, newKey);
      } catch (e) {
        if (ownsOperation()) set({ error: e instanceof ApiFailure ? e.code : 'error' });
        throw e;
      } finally {
        if (ownsOperation()) set({ busy: false });
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
    clearError: () => set({ error: null }),

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
        await adoptSession(session);
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
        await adoptSession(session);
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
      const stored = load();
      if (!stored?.refreshToken) return;
      const generation = authGeneration;
      if (refreshInFlight?.generation === generation && sameSession(refreshInFlight.session, stored)) return refreshInFlight.promise;
      const run = async () => {
        if (generation !== authGeneration) return;
        const current = load();
        if (current?.accountId !== stored.accountId || current.deviceId !== stored.deviceId || !current.refreshToken) return;
        const ownsSession = captureCredentialOwner();
        try {
          // Read INSIDE the lock. Read outside it and a tab that queues behind another tab's rotation
          // sends the token that rotation just retired; the server reads a replayed token as theft and
          // revokes the whole family, dropping every tab to anonymous — with nothing actually stolen.
          const session = await api.refresh(current.refreshToken);
          await withSessionOwnership(() => {
            if (ownsSession()) applySession(session, true);
          });
        } catch (e) {
          await withSessionOwnership(() => {
            if (!ownsSession()) return;
            // A rejected credential still signs out, while local learning data stays.
            if (e instanceof ApiFailure && e.status === 401 && (e.code === 'refresh_reused' || e.code === 'refresh_invalid')) {
              recordSessionEvent(e.code);
              clearSession();
            } else recordSessionEvent(e instanceof ApiFailure && e.code === 'network' ? 'refresh_network' : 'refresh_failed');
          });
        }
      };
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      const promise = locks
        ? locks.request('account-refresh', run).then(() => undefined)
        : run();
      const flight = { generation, session: stored, promise };
      refreshInFlight = flight;
      try {
        await promise;
      } finally {
        if (refreshInFlight === flight) refreshInFlight = null;
      }
    },

    getAccessToken: async () => {
      if (get().status !== 'authenticated') return null;
      const generation = authGeneration;
      const accountId = get().accountId;
      const persisted = load();
      if (persisted?.accountId !== accountId) return null;
      const incarnation = persisted.incarnation;
      const { accessToken, accessExpiresAt } = get();
      if (accessToken && Date.now() < accessExpiresAt - 30_000) return accessToken;
      await get().refresh();
      const state = get();
      return generation === authGeneration && accountId === state.accountId && incarnation === load()?.incarnation && Date.now() < state.accessExpiresAt ? state.accessToken : null;
    },

    logout: async () => {
      const generation = authGeneration;
      const owner = await prepareLogicalSessionOwner();
      if (generation !== authGeneration || !owner?.current()) return;
      const token = owner.refreshToken;
      const revoked = token ? api.logout(token).catch(() => undefined) : Promise.resolve();
      await withSessionOwnership(async () => {
        if (!owner.current()) return;
        clearSession();
        recordSessionEvent('signed_out');
        const ownsCleanup = captureLogicalSessionOwner();
        // Unpushed progress survives sign-out; adoption cannot race the cleanup of a clean session.
        try {
          if ((await db.pending.count()) === 0 && ownsCleanup()) {
            await wipeSyncedData();
            if (ownsCleanup()) forgetLastAccount();
          }
        } catch {
          // best-effort
        }
      });
      await revoked;
    },

    startDeviceLink: () => api.deviceStart(deviceName()),

    pollDeviceLink: async (requestId) => {
      const res = await api.devicePoll(requestId);
      if (res.status === 'approved' && res.session) {
        await adoptSession(res.session);
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
      const generation = authGeneration;
      const owner = await prepareLogicalSessionOwner();
      if (generation !== authGeneration || !owner?.current()) throw new ApiFailure('unauthorized', 401);
      const token = await get().getAccessToken();
      if (generation !== authGeneration || !owner.current()) throw new ApiFailure('unauthorized', 401);
      if (!token) {
        const authenticated = get().status === 'authenticated';
        throw new ApiFailure(authenticated ? 'network' : 'unauthorized', authenticated ? 0 : 401);
      }
      await api.deleteAccount(token);
      await withSessionOwnership(async () => {
        if (!owner.current()) throw new ApiFailure('unauthorized', 401);
        clearSession();
        recordSessionEvent('signed_out');
        const ownsCleanup = captureLogicalSessionOwner();
        try {
          await wipeSyncedData(); // remove the now-orphaned local copy too
          if (!ownsCleanup()) return;
          forgetLastAccount();
          // Independently, as everywhere else: a failure in one half must not skip the other.
          const [data, files] = await Promise.all([ran(releasePreviousAccountData), ran(discardAllBookFiles)]);
          if (ownsCleanup()) setOwners(files ? undefined : load()?.fileOwner, data ? undefined : load()?.dataOwner);
        } catch {
          // best-effort
        }
      });
    },
  };
});
