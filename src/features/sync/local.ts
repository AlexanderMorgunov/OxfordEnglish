/**
 * Write-through layer (slice 2d). Every local mutation of a synced store goes through here so the row
 * is stamped with sync metadata (`updatedAt`/`updatedBy`, plus `statusUpdatedAt` for wordStatus and a
 * global `syncId` for the append-only stores) and, when an account is active, marked dirty for the next
 * push. Anonymous users get the stamp (keeping data sync-ready) but no dirty marker — on first login,
 * reconcile enqueues every local row wholesale, so nothing is missed.
 *
 * NOTE (deferred): hard deletes (removing a book/bookmark) do NOT yet propagate — a delete on one device
 * can be resurrected by a pull on another. Soft-delete + read-filtering + tombstones is a later slice.
 */
import { db, EPOCH_SENTINEL, type BookRecord, type Bookmark, type CheckpointResult, type ExerciseAttempt, type SettingRecord, type SrsCard, type WordStatus } from '@/db/db';
import { accountsEnabled } from '@/features/account/config';
import { useAccount } from '@/features/account/store';
import { getInstallId } from './meta';
import { markDirty, type SyncedRow } from './engine';
import type { SyncedStore } from './resolve';
import { nudgeSync } from './run';

/** True when writes should be tracked for push (a backend is configured AND the user is signed in). */
export function isSyncing(): boolean {
  return accountsEnabled() && useAccount.getState().status === 'authenticated';
}
const syncActive = isSyncing;

/** Mark a row dirty and schedule a push — the single "this changed, sync it" call. */
async function dirty(store: Parameters<typeof markDirty>[0], row: object): Promise<void> {
  if (!syncActive()) return;
  await markDirty(store, row as SyncedRow);
  nudgeSync();
}

async function installId(): Promise<string> {
  try {
    return await getInstallId();
  } catch {
    return 'local';
  }
}

async function newSyncId(): Promise<string> {
  return `${await installId()}:${crypto.randomUUID()}`;
}

/** Natural creation time to backfill `updatedAt` for an imported row (never `now()` — F11). */
function importCreation(store: SyncedStore, r: Record<string, unknown>): number {
  if (store === 'wordStatus') return (r.firstSeenAt as number) ?? EPOCH_SENTINEL;
  if (store === 'books') return (r.addedAt as number) ?? EPOCH_SENTINEL;
  if (store === 'bookmarks') return (r.createdAt as number) ?? EPOCH_SENTINEL;
  if (store === 'srsCards') {
    const lr = (r.card as { last_review?: unknown } | undefined)?.last_review;
    return lr ? new Date(lr as string).getTime() : EPOCH_SENTINEL;
  }
  return (r.timestamp as number) ?? EPOCH_SENTINEL; // attempts / checkpoints
}

/**
 * Stamp sync-meta on rows being bulk-imported (backup restore / .online migration) so they carry a global
 * `syncId` (append-only) + meta and thus sync correctly later. Rows that ALREADY carry meta (a sync-aware
 * backup from another install) keep it — their identity/timing is preserved. Pure (takes a pre-fetched
 * install id) so it can run inside a Dexie transaction. See stampForImport's callers.
 */
export function stampImported<T extends object>(store: SyncedStore, rows: T[], installId: string): T[] {
  return rows.map((r) => {
    const out = { ...(r as Record<string, unknown>) };
    if (out.updatedBy == null) out.updatedBy = installId;
    if (out.updatedAt == null) out.updatedAt = importCreation(store, out);
    if (store === 'wordStatus' && out.statusUpdatedAt == null) out.statusUpdatedAt = out.updatedAt;
    if ((store === 'attempts' || store === 'checkpoints') && out.syncId == null) out.syncId = `${installId}:${crypto.randomUUID()}`;
    return out as T;
  });
}

/** After a restore, enqueue the given stores' rows for push (only when signed in). Broad by design —
 *  restore is a one-shot action, and markDirty dedupes, so re-queuing already-synced rows is harmless. */
export async function enqueueForPush(stores: SyncedStore[]): Promise<void> {
  if (!isSyncing()) return;
  for (const store of stores) {
    const rows = (await db.table(store).toArray()) as SyncedRow[];
    for (const row of rows) {
      // Guard a malformed legacy row: an append-only row with no syncId would enqueue as id 'undefined'
      // and silently merge with every other such row. Skip it (v7/import stamping covers real rows).
      if ((store === 'attempts' || store === 'checkpoints') && !row.syncId) continue;
      await markDirty(store, row);
    }
  }
}

/** Read the stable install id (for stamping imports outside a store setter). */
export function currentInstallId(): Promise<string> {
  return installId();
}

/** Add an append-only event (attempt/checkpoint) with a fresh global `syncId` + meta. */
export async function addAttempt(attempt: Omit<ExerciseAttempt, 'id' | 'syncId'>): Promise<void> {
  const row: ExerciseAttempt = { ...attempt, syncId: await newSyncId(), updatedAt: attempt.timestamp, updatedBy: await installId() };
  await db.attempts.add(row);
  await dirty('attempts', row);
}

export async function addCheckpoint(result: Omit<CheckpointResult, 'id' | 'syncId'>): Promise<void> {
  const row: CheckpointResult = { ...result, syncId: await newSyncId(), updatedAt: result.timestamp, updatedBy: await installId() };
  await db.checkpoints.add(row);
  await dirty('checkpoints', row);
}

/** Add a new SRS card (skips if it exists — never resets a live schedule), stamped + marked dirty. */
export async function addSrsCard(card: SrsCard): Promise<void> {
  if (await db.srsCards.get(card.id)) return;
  const row: SrsCard = { ...card, updatedAt: Date.now(), updatedBy: await installId() };
  await db.srsCards.add(row);
  await dirty('srsCards', row);
}

export async function putSrsCard(card: SrsCard): Promise<void> {
  const row: SrsCard = { ...card, updatedAt: Date.now(), updatedBy: await installId() };
  await db.srsCards.put(row);
  await dirty('srsCards', row);
}

export async function patchSrsCard(id: string, patch: Partial<SrsCard>): Promise<void> {
  const current = await db.srsCards.get(id);
  if (!current) return;
  await putSrsCard({ ...current, ...patch });
}

/** Put a word status. `statusUpdatedAt` bumps only when the status value actually changes (F6). */
export async function putWordStatus(row: WordStatus): Promise<void> {
  const existing = await db.wordStatus.get(row.word);
  const now = Date.now();
  const statusChanged = existing?.status !== row.status;
  const full: WordStatus = {
    ...row,
    updatedAt: now,
    updatedBy: await installId(),
    statusUpdatedAt: statusChanged ? now : (existing?.statusUpdatedAt ?? now),
  };
  await db.wordStatus.put(full);
  await dirty('wordStatus', full);
}

export async function addBook(record: BookRecord): Promise<void> {
  const row: BookRecord = { ...record, updatedAt: Date.now(), updatedBy: await installId() };
  await db.books.add(row);
  await dirty('books', row);
}

export async function patchBook(id: string, patch: Partial<BookRecord>): Promise<void> {
  const current = await db.books.get(id);
  if (!current) return;
  const row: BookRecord = { ...current, ...patch, updatedAt: Date.now(), updatedBy: await installId() };
  await db.books.put(row);
  await dirty('books', row);
}

export async function addBookmark(bookmark: Bookmark): Promise<void> {
  const row: Bookmark = { ...bookmark, updatedAt: Date.now(), updatedBy: await installId() };
  await db.bookmarks.add(row);
  await dirty('bookmarks', row);
}

/** Mirror a synced setting (learner level, UI lang, reader toggles) into the `settings` table. Written
 *  even when anonymous — so a first login's reconcile carries locally-accumulated settings — but only
 *  marked dirty when signed in (like every other store). Coarse: one row per store, LWW. */
export async function stampSetting(key: string, value: unknown): Promise<void> {
  try {
    const row: SettingRecord = { key, value, updatedAt: Date.now(), updatedBy: await installId() };
    await db.settings.put(row);
    await dirty('settings', row);
  } catch {
    // best-effort — settings sync is non-critical and must never throw into a store setter
  }
}

/** Soft-delete a book (tombstone). Keeps the row so the delete PROPAGATES on sync; per H1 it sets
 *  `deletedAt` but does NOT bump `updatedAt`, so a later genuine re-add can still win the row back.
 *  Reads must filter these out (see reader listBooks). */
export async function softDeleteBook(id: string): Promise<void> {
  const current = await db.books.get(id);
  if (!current) return;
  const row: BookRecord = { ...current, deletedAt: Date.now(), updatedBy: await installId() };
  await db.books.put(row);
  await dirty('books', row);
}

/** Soft-delete a bookmark (tombstone) — same H1 semantics as softDeleteBook. Reads filter these out. */
export async function softDeleteBookmark(id: string): Promise<void> {
  const current = await db.bookmarks.get(id);
  if (!current) return;
  const row: Bookmark = { ...current, deletedAt: Date.now(), updatedBy: await installId() };
  await db.bookmarks.put(row);
  await dirty('bookmarks', row);
}
