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
import { db, type BookRecord, type Bookmark, type CheckpointResult, type ExerciseAttempt, type SrsCard, type WordStatus } from '@/db/db';
import { accountsEnabled } from '@/features/account/config';
import { useAccount } from '@/features/account/store';
import { getInstallId } from './meta';
import { markDirty, type SyncedRow } from './engine';
import { nudgeSync } from './run';

function syncActive(): boolean {
  return accountsEnabled() && useAccount.getState().status === 'authenticated';
}

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
