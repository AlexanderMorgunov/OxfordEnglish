/**
 * Settings-tier sync bridge (slice 4a, F9). The learner level/placement + a few prefs live in Zustand
 * stores with hand-rolled localStorage persist, not Dexie. This registry lets each store expose an
 * apply-from-sync callback WITHOUT the sync layer importing the stores (which would cycle: store →
 * local.ts → run.ts). Stores register on module load; `hydrateSettings` (called from run.ts) applies
 * values other devices wrote back into the stores.
 */
import { db } from '@/db/db';
import { getInstallId } from './meta';

export interface SettingBridge {
  key: string;
  /** Apply a synced value to the store + localStorage, WITHOUT re-stamping it (avoids a push loop). */
  applyFromSync: (value: unknown) => void;
}

const bridges = new Map<string, SettingBridge>();

export function registerSettingBridge(bridge: SettingBridge): void {
  bridges.set(bridge.key, bridge);
}

/**
 * Apply settings that OTHER devices wrote to their stores. Skips rows this install wrote — they're
 * already reflected locally by construction, so a boot-hydrate can never revert a fresh local change
 * (advisor: the missing guard that otherwise loses an offline edit).
 */
export async function hydrateSettings(): Promise<void> {
  let installId: string | null = null;
  try {
    installId = await getInstallId();
  } catch {
    // no IndexedDB — nothing to hydrate
  }
  let rows: { key: string; value: unknown; updatedBy?: string }[];
  try {
    rows = await db.settings.toArray();
  } catch {
    return;
  }
  for (const row of rows) {
    if (row.updatedBy && row.updatedBy === installId) continue; // wrote it here → already applied
    bridges.get(row.key)?.applyFromSync(row.value);
  }
}
