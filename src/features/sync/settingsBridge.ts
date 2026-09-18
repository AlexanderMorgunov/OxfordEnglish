/**
 * Settings-tier sync bridge (slice 4a, F9). The learner level/placement + a few prefs live in Zustand
 * stores with hand-rolled localStorage persist, not Dexie. This registry lets each store expose an
 * apply-from-sync callback WITHOUT the sync layer importing the stores (which would cycle: store →
 * local.ts → run.ts). Stores register on module load; `hydrateSettings` (called from run.ts) applies
 * values other devices wrote back into the stores.
 */
import { db } from '@/db/db';
import { getInstallId } from './meta';

/**
 * `scope` is a discriminated union rather than an optional flag so a new bridge cannot default into the
 * wrong half: an account-scoped one is forced by the type to say how it resets, a device-scoped one
 * cannot offer a reset at all.
 *
 * The split is not cosmetic. `wipeSyncedData` clears `db.settings`, but these stores keep their own
 * localStorage copy, so account state survives into the next account — `bookFileSync` is documented as
 * an ACCOUNT choice, and left at "on" it starts uploading the next account's books without that account
 * ever opting in. Device preferences must NOT reset: flipping someone's UI language or reader font size
 * because they signed out would be hostile, and those say nothing about whose account it is.
 */
export type SettingBridge = {
  key: string;
  /** Apply a synced value to the store + localStorage, WITHOUT re-stamping it (avoids a push loop). */
  applyFromSync: (value: unknown) => void;
} & (
  | { scope: 'device' }
  | {
      scope: 'account';
      /** Return the store to its first-run state. Must NOT stamp — the account being left would receive
       *  the reset as a deliberate change and carry it to its other devices. */
      resetToDefault: () => void;
    }
);

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

/**
 * Called when the device passes to a DIFFERENT account — NOT on an ordinary logout. The reset does not
 * stamp, and `hydrateSettings` above skips any row this install wrote, so a reset on a path the same
 * account returns from would never be undone by a later sync.
 *
 * Covers only bridges whose module has been evaluated. Both account-scoped ones are eager today
 * (`blobSync` through `run.ts`, `learner/store` through `AppLayout`); making either lazy would drop it
 * from the reset with no type error, which the `scope` union does NOT catch.
 */
export function resetAccountSettings(): void {
  for (const bridge of bridges.values()) {
    if (bridge.scope === 'account') bridge.resetToDefault();
  }
}
