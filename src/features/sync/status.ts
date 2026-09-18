/**
 * Observable sync status for the UI (slice 4d). `run.ts` drives it around each sync cycle; the account
 * settings surface reads it to show "synced / syncing / offline / error" + the unsynced-change count.
 */
import { create } from 'zustand';

/** `paused` = the account may download but not upload: syncing is part of the paid plan. It is NOT an
 *  error state, and must never be rendered as one — nothing is broken and nothing is lost. */
export type SyncPhase = 'idle' | 'syncing' | 'error' | 'offline' | 'paused';

export interface SyncStatus {
  phase: SyncPhase;
  /** Epoch ms of the last successful sync, or null if none this session. */
  lastSyncedAt: number | null;
  /**
   * Epoch ms of the last completed DOWNLOAD half, or null if none this session. Distinct from
   * `lastSyncedAt` on purpose: that one is deliberately frozen while pushes are refused for want of a
   * plan (nothing the user writes is landing, and the settings line must say so), but the pull runs
   * regardless. Anything asking "might another device's data have arrived?" wants this, not that —
   * otherwise the answer is permanently "no" for a lapsed-Pro account, which is exactly the account
   * whose other device holds data it cannot push.
   */
  lastPulledAt: number | null;
  /** Rows still awaiting push (dirty queue length as of the last update). */
  pending: number;
}

export const useSyncStatus = create<SyncStatus>(() => ({ phase: 'idle', lastSyncedAt: null, lastPulledAt: null, pending: 0 }));

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  useSyncStatus.setState(patch);
}

/**
 * Every field here describes ONE account's sync on THIS device, and none of it may outlive a switch.
 * A carried-over `lastSyncedAt` tells the next account it synced minutes ago when it has never contacted
 * the server; a carried-over `lastPulledAt` tells the reader a download just landed, which is the signal
 * it uses to decide whether another device's reading position is worth offering.
 */
export function resetSyncStatus(): void {
  useSyncStatus.setState({ phase: 'idle', lastSyncedAt: null, lastPulledAt: null, pending: 0 });
}
