/**
 * Opt-in book-file sync (slice 3). Book metadata + reading position already sync via the engine; the file
 * BLOB itself is the opt-in part (it may hold copyrighted/personal content — see design §privacy). Upload
 * is gated on the per-device toggle below; DOWNLOAD-if-missing runs whenever signed in, so a book added on
 * one device is readable on another regardless of that device's upload preference. All calls are
 * best-effort: quota/size/offline failures never block reading.
 */
import { create } from 'zustand';
import { BLOB_MAX_BYTES } from '@/features/account/contract';
import { accountsEnabled } from '@/features/account/config';
import { useAccount } from '@/features/account/store';
import * as api from '@/features/account/api';
import { ApiFailure } from '@/features/account/api';
import { db } from '@/db/db';
import { isDeleted } from '@/features/sync/resolve';
import { getBookFile, saveBookFile } from './storage';

const PREF_KEY = 'oxford-sync-book-files';

function loadPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

/** Per-device opt-in to upload this device's book files. Default off. Turning it on backfills existing books. */
export const useBookFileSync = create<{ enabled: boolean; setEnabled: (v: boolean) => void }>((set) => ({
  enabled: loadPref(),
  setEnabled: (v) => {
    try {
      localStorage.setItem(PREF_KEY, v ? '1' : '0');
    } catch {
      // ignore storage failures
    }
    set({ enabled: v });
    if (v) void syncAllBookFiles();
  },
}));

async function token(): Promise<string | null> {
  if (!accountsEnabled()) return null;
  return useAccount.getState().getAccessToken();
}

export type UploadOutcome = 'ok' | 'skipped' | 'quota' | 'error';

/** Upload one book's OPFS file. Returns an outcome (rather than throwing) so the import path can fire it
 *  and forget, while the bulk sync can stop on `quota`. Skips when the toggle is off or the file is >20 MB. */
export async function uploadBookFile(id: string): Promise<UploadOutcome> {
  if (!useBookFileSync.getState().enabled) return 'skipped';
  const t = await token();
  if (!t) return 'skipped';
  try {
    const file = await getBookFile(id);
    if (file.size > BLOB_MAX_BYTES) return 'skipped'; // too large to sync — stays local-only
    const target = await api.blobUploadUrl(t, id, file.size);
    await api.blobUpload(t, target, file);
    await api.blobCommit(t, id, target.key, file.size);
    return 'ok';
  } catch (e) {
    return e instanceof ApiFailure && e.code === 'quota_exceeded' ? 'quota' : 'error';
  }
}

/** Fetch a book's file from the cloud if it isn't already in OPFS. Runs regardless of the upload toggle. */
export async function downloadBookFileIfMissing(id: string): Promise<void> {
  const t = await token();
  if (!t) return;
  try {
    await getBookFile(id);
    return; // already local
  } catch {
    // not local — try the cloud copy
  }
  try {
    const url = await api.blobDownloadUrl(t, id);
    const blob = await api.blobDownload(t, url);
    await saveBookFile(id, blob);
  } catch {
    // no remote copy or offline — the reader surfaces a missing-file error as before
  }
}

/** Delete a book's cloud blob (releasing its quota). Runs on removal regardless of the toggle. */
export async function deleteRemoteBookFile(id: string): Promise<void> {
  const t = await token();
  if (!t) return;
  await api.blobDelete(t, id).catch(() => undefined);
}

/** Upload every local book file not already in the cloud (used when the toggle is switched on). */
export async function syncAllBookFiles(): Promise<void> {
  if (!useBookFileSync.getState().enabled) return;
  const t = await token();
  if (!t) return;
  const remote = await api
    .blobList(t)
    .then((r) => new Set(r.blobs.map((b) => b.bookId)))
    .catch(() => new Set<string>());
  const books = await db.books.toArray();
  for (const b of books) {
    if (isDeleted(b) || remote.has(b.id)) continue;
    if ((await uploadBookFile(b.id)) === 'quota') break; // account full — stop rather than hammer failures
  }
}
