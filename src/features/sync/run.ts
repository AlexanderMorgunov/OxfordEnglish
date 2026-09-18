/**
 * Sync orchestration (slice 2d): builds the real transport from the account session + api, and decides
 * WHEN to sync — on app open, on reconnect (`online`), when the session becomes authenticated, and a
 * debounced nudge after local writes. All entry points are inert unless a backend is configured and the
 * user is signed in, so anonymous/offline usage is untouched. Failures are soft (retried next trigger).
 */
import { db } from '@/db/db';
import { accountsEnabled } from '@/features/account/config';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { claimPending } from '@/features/account/billing';
import { ApiFailure, syncPull, syncPush } from '@/features/account/api';
import { syncAllBookFiles } from '@/features/reader/blobSync';
import { syncWith, type SyncTransport } from './engine';
import { hydrateSettings } from './settingsBridge';
import { resetSyncStatus, setSyncStatus, useSyncStatus } from './status';

const pendingCount = (): Promise<number> => db.pending.count().catch(() => 0);

function transport(): SyncTransport {
  const token = async (): Promise<string> => {
    const t = await useAccount.getState().getAccessToken();
    if (!t) throw new ApiFailure('unauthorized', 401);
    return t;
  };
  return {
    push: async (body) => syncPush(await token(), body),
    pull: async (since, snapshot) => syncPull(await token(), since, snapshot),
  };
}

let running = false;
let rerun = false;

/**
 * Run one sync cycle if signed in. Coalesces overlapping calls (the engine is single-flight too) — but
 * a trigger that arrives DURING a cycle is remembered rather than dropped. Dropping it silently was
 * already wrong for `online` and `visibilitychange`; an account switch makes it load-bearing, because
 * the switch wipe abandons the running cycle and the trigger for the new account arrives synchronously
 * from `applySession`, i.e. always while `running` is still true.
 */
export async function triggerSync(): Promise<void> {
  if (!accountsEnabled()) return;
  if (running) {
    rerun = true;
    return;
  }
  const account = useAccount.getState().accountId;
  if (useAccount.getState().status !== 'authenticated' || !account) return;
  running = true;
  setSyncStatus({ phase: 'syncing' });
  try {
    const { pushBlocked, stale } = await syncWith(account, transport());
    // Abandoned because the account changed under it. Nothing synced, so nothing may be stamped as
    // synced and the backoff must not be reset — but the phase has to leave `syncing`, or the settings
    // line sits on "syncing" until the next local write. The follow-up cycle for the account that is
    // current NOW is already queued: the switch fired a trigger while this one was running, and the
    // `finally` below consumes it.
    if (stale) {
      setSyncStatus({ phase: 'idle', pending: await pendingCount() });
      return;
    }
    cancelRetry(); // a cycle got through; the backoff starts from scratch next time one does not
    void sweepBookFiles();
    await hydrateSettings(); // apply any settings other devices just pushed
    setSyncStatus({
      // Refused for want of a plan is not a failure: the download half ran, the local queue is intact,
      // and showing an error badge for a deliberate product boundary would read as a broken app.
      phase: pushBlocked ? 'paused' : 'idle',
      lastSyncedAt: pushBlocked ? useSyncStatus.getState().lastSyncedAt : Date.now(),
      // Unconditional: `syncWith` always runs `pullLoop`, blocked push or not, so a refused upload says
      // nothing about whether other devices' data just arrived.
      lastPulledAt: Date.now(),
      pending: await pendingCount(),
    });
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setSyncStatus({ phase: offline ? 'offline' : 'error', pending: await pendingCount() });
    scheduleRetry();
  } finally {
    running = false;
    // One extra cycle at most, and only when a trigger actually arrived mid-cycle: the flag clears
    // before the re-entry. The case to reason about is active reading, not a quiet app — `nudgeSync`
    // fires every 3 s, so any nudge landing inside a cycle now costs a round trip that used to be
    // dropped. Paying it is the point: the dropped one is what left a switched-to account unsynced.
    if (rerun) {
      rerun = false;
      void triggerSync();
    }
  }
}


/** A failed book-file upload had no retry at all: it was fired and forgotten from the import path, and
 *  the only thing that ever tried again was switching the setting off and on. `syncAllBookFiles` lists
 *  what the cloud already holds and uploads the rest, so re-running it is safe; throttling keeps it off
 *  the hot path, since a sync cycle can follow every few local writes. */
const BOOK_SWEEP_EVERY_MS = 10 * 60_000;
let lastBookSweep = 0;

async function sweepBookFiles(): Promise<void> {
  if (Date.now() - lastBookSweep < BOOK_SWEEP_EVERY_MS) return;
  lastBookSweep = Date.now();
  await syncAllBookFiles().catch(() => undefined);
}

/** Backoff schedule for a failed cycle, in ms. Ends rather than looping forever: past a few minutes the
 *  app is almost certainly in the background, and returning to the tab triggers a fresh attempt. */
const RETRY_DELAYS = [15_000, 30_000, 60_000, 120_000, 300_000];
let retryAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The UI says "we'll retry later", so something has to. Nothing did: the triggers were app open, the
 * `online` event, signing in, and a local write — and on a VPN or a flaky link `navigator.onLine` stays
 * true, so `online` never fires. A failed sync simply sat there until the user reloaded the page.
 */
function scheduleRetry(): void {
  if (retryTimer || retryAt >= RETRY_DELAYS.length) return;
  const delay = RETRY_DELAYS[retryAt];
  retryAt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void triggerSync();
  }, delay);
}

function cancelRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  retryAt = 0;
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
  void useEntitlement.getState().load();
  // A payment can be confirmed long after the payer stopped looking at the success page — they close the
  // tab, the callback lands a minute later, and nothing would ever redeem the token. One quiet attempt
  // per boot picks that up; with nothing pending it does not even touch the network.
  void claimPending(1);
  if (typeof window !== 'undefined') window.addEventListener('online', () => void triggerSync());
  // Coming back to the tab is the most reliable "the network is probably fine now" signal there is — and
  // unlike `online`, it fires on a VPN, where the browser never thought anything was wrong.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      cancelRetry();
      void triggerSync();
      if (useSyncStatus.getState().phase === 'error') void useEntitlement.getState().load();
    });
  }
  let wasAuthed = useAccount.getState().status === 'authenticated';
  let wasAccount = useAccount.getState().accountId;
  useAccount.subscribe((state) => {
    const authed = state.status === 'authenticated';
    if (authed && !wasAuthed) {
      void triggerSync(); // just signed in / linked
      void useEntitlement.getState().load();
      // Also here, not only at boot: a payment made before the session was ready has nothing to redeem
      // against until this moment.
      void claimPending(1);
    }
    // Switching accounts never passes through anonymous, so neither branch above fires and the previous
    // account's plan would survive into the new session — one account showing another's Pro.
    if (authed && wasAuthed && state.accountId !== wasAccount) {
      useEntitlement.getState().clear();
      void useEntitlement.getState().load();
      resetSyncStatus(); // before the trigger, which stamps `syncing` on its way in
      // The switch wipe abandons whatever cycle was running for the old account; without this the new
      // one waits for the next local write. Signing in from anonymous is already covered above.
      void triggerSync();
    }
    // Signing out must drop the plan too, or the AI affordances stay visible with no token behind them.
    if (!authed && wasAuthed) {
      useEntitlement.getState().clear();
      resetSyncStatus(); // logging out and into a DIFFERENT account goes through here, not the branch above
    }
    wasAuthed = authed;
    wasAccount = state.accountId;
  });
}
