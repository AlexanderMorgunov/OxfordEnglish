/**
 * Sync orchestration (slice 2d): builds the real transport from the account session + api, and decides
 * WHEN to sync — on app open, on reconnect (`online`), when the session becomes authenticated, and a
 * debounced nudge after local writes. All entry points are inert unless a backend is configured and the
 * user is signed in, so anonymous/offline usage is untouched. Failures are soft (retried next trigger).
 */
import { db } from '@/db/db';
import { accountsEnabled } from '@/features/account/config';
import { useAccount } from '@/features/account/store';
import { ApiFailure, syncPull, syncPush } from '@/features/account/api';
import { syncWith, type SyncTransport } from './engine';
import { hydrateSettings } from './settingsBridge';
import { setSyncStatus } from './status';

const pendingCount = (): Promise<number> => db.pending.count().catch(() => 0);

function transport(): SyncTransport {
  const token = async (): Promise<string> => {
    const t = await useAccount.getState().getAccessToken();
    if (!t) throw new ApiFailure('unauthorized', 401);
    return t;
  };
  return {
    push: async (body) => syncPush(await token(), body),
    pull: async (since) => syncPull(await token(), since),
  };
}

let running = false;

/** Run one sync cycle if signed in. Coalesces overlapping calls (the engine is single-flight too). */
export async function triggerSync(): Promise<void> {
  if (running || !accountsEnabled()) return;
  const account = useAccount.getState().accountId;
  if (useAccount.getState().status !== 'authenticated' || !account) return;
  running = true;
  setSyncStatus({ phase: 'syncing' });
  try {
    await syncWith(account, transport());
    await hydrateSettings(); // apply any settings other devices just pushed
    setSyncStatus({ phase: 'idle', lastSyncedAt: Date.now(), pending: await pendingCount() });
  } catch {
    // soft — a later trigger retries; offline errors just leave the dirty queue intact
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setSyncStatus({ phase: offline ? 'offline' : 'error', pending: await pendingCount() });
  } finally {
    running = false;
  }
}

let scheduled: ReturnType<typeof setTimeout> | null = null;
let firstScheduledAt = 0;

/** Debounced nudge after local writes — batches a burst of edits into one push, but fires within
 *  `maxWait` regardless so a long session (e.g. tapping words while reading) still pushes periodically. */
export function nudgeSync(delay = 3000, maxWait = 30_000): void {
  if (!accountsEnabled()) return;
  const now = Date.now();
  if (!scheduled) firstScheduledAt = now;
  else clearTimeout(scheduled);
  const wait = Math.min(delay, Math.max(0, maxWait - (now - firstScheduledAt)));
  scheduled = setTimeout(() => {
    scheduled = null;
    firstScheduledAt = 0;
    void triggerSync();
  }, wait);
}

/** App-boot wiring: initial sync + reconnect + on-login. Call once from main.tsx. */
export function initSync(): void {
  if (!accountsEnabled()) return;
  void hydrateSettings(); // apply settings synced in a previous session before the first sync completes
  void triggerSync();
  if (typeof window !== 'undefined') window.addEventListener('online', () => void triggerSync());
  let wasAuthed = useAccount.getState().status === 'authenticated';
  useAccount.subscribe((state) => {
    const authed = state.status === 'authenticated';
    if (authed && !wasAuthed) void triggerSync(); // just signed in / linked
    wasAuthed = authed;
  });
}
