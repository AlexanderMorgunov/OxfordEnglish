/**
 * Observable sync status for the UI (slice 4d). `run.ts` drives it around each sync cycle; the account
 * settings surface reads it to show "synced / syncing / offline / error" + the unsynced-change count.
 */
import { create } from 'zustand';

export type SyncPhase = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncStatus {
  phase: SyncPhase;
  /** Epoch ms of the last successful sync, or null if none this session. */
  lastSyncedAt: number | null;
  /** Rows still awaiting push (dirty queue length as of the last update). */
  pending: number;
}

export const useSyncStatus = create<SyncStatus>(() => ({ phase: 'idle', lastSyncedAt: null, pending: 0 }));

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  useSyncStatus.setState(patch);
}
