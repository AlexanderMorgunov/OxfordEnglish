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
  /** Rows still awaiting push (dirty queue length as of the last update). */
  pending: number;
}

export const useSyncStatus = create<SyncStatus>(() => ({ phase: 'idle', lastSyncedAt: null, pending: 0 }));

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  useSyncStatus.setState(patch);
}
