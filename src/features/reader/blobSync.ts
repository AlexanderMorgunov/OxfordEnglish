/**
 * Opt-in book-file sync (slice 3). Book metadata + reading position already sync via the engine; the file
 * BLOB itself is the opt-in part (it may hold copyrighted/personal content — see design §privacy). Upload
 * is gated on the ACCOUNT-wide toggle below; DOWNLOAD-if-missing runs whenever signed in. All calls are
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
import { stampSetting } from '@/features/sync/local';
import { registerSettingBridge } from '@/features/sync/settingsBridge';
import { getBookFile, saveBookFile } from './storage';

const PREF_KEY = 'oxford-sync-book-files';
const SETTING_KEY = 'bookFileSync';

function loadPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}

function writePref(v: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, v ? '1' : '0');
  } catch {
    // ignore storage failures
  }
}

/**
 * Whether this account uploads its book files. An ACCOUNT choice, not a per-device one.
 *
 * It began device-local, on the reasoning that uploading a file is a decision about the files sitting on
 * THIS device. In practice that produced the opposite of privacy: book *metadata* syncs unconditionally,
 * so a device with the toggle off handed every other device a library full of entries that could never
 * be opened, and nothing said why. Someone who has already answered "yes, put my books in the cloud"
 * should not have to answer it again on each device, and the local copy stays the source of truth while
 * signed out.
 */
export const useBookFileSync = create<{ enabled: boolean; setEnabled: (v: boolean) => void }>((set) => ({
  enabled: loadPref(),
  setEnabled: (v) => {
    writePref(v);
    set({ enabled: v });
    void stampSetting(SETTING_KEY, v); // carry the choice to the account's other devices
    if (v) void syncAllBookFiles();
  },
}));

/** Apply another device's choice. Deliberately does NOT re-stamp — that would bounce back as a push. */
function applyFromSync(value: unknown): void {
  if (typeof value !== 'boolean' || value === useBookFileSync.getState().enabled) return;
  writePref(value);
  useBookFileSync.setState({ enabled: value });
  // Turning on elsewhere means this device's books belong in the cloud too; that is the point of the
  // setting being account-wide. Turning off stops future uploads and leaves what is already there.
  if (value) void syncAllBookFiles();
}

registerSettingBridge({ key: SETTING_KEY, applyFromSync });

async function token(): Promise<string | null> {
  if (!accountsEnabled()) return null;
  return useAccount.getState().getAccessToken();
}

/** Why an upload did not happen. `skipped` used to mean all three of the middle ones at once, which made
 *  a permanent refusal (too large) indistinguishable from a passing one (no token). `no-plan` is split out
 *  of `error` because the toggle is NOT behind the paywall: any signed-in user can switch it on, and
 *  `/v1/blobs/upload-url` answers 402 without an active plan — so "something went wrong, we'll retry"
 *  would be the standing message for every free account, and retrying is precisely what cannot help. */
export type UploadOutcome = 'ok' | 'sync-off' | 'signed-out' | 'no-file' | 'too-large' | 'quota' | 'no-plan' | 'error';

/** The outcomes worth telling the owner of the device about. The rest are either normal (`ok`), a choice
 *  they already made (`sync-off`), or the ordinary state of not being signed in. */
export type UploadIssue = Extract<UploadOutcome, 'too-large' | 'quota' | 'no-plan' | 'error' | 'signed-out'>;

const ISSUE_KEY = 'oxford-book-upload-issues';

function loadIssues(): Record<string, UploadIssue> {
  try {
    const raw = localStorage.getItem(ISSUE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    // Shape-checked, not just parsed: `JSON.parse('null')` is a successful parse, and the result would
    // then be indexed on every Library render — taking the whole page down rather than one marker.
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, UploadIssue>) : {};
  } catch {
    return {};
  }
}

/**
 * Why each book on THIS device is not in the cloud. Per-device on purpose: it is a fact about this
 * device's attempt, so it must not ride the `books` row — that store syncs, and whole-row LWW would both
 * carry the flag to devices it is not true of and erase it on the next pull.
 *
 * A marker is not a dead end. `sweepBookFiles` re-runs `syncAllBookFiles` every ten minutes, so `error`
 * and `signed-out` clear themselves once the cause goes away; the store exists so that until then the
 * device that made the file can say what is wrong, instead of the silence that let a broken upload path
 * go unnoticed.
 */
export const useBookUploadIssues = create<{
  issues: Record<string, UploadIssue>;
  note: (id: string, issue: UploadIssue | null) => void;
  prune: (keep: Set<string>) => void;
}>((set, get) => ({
  issues: loadIssues(),
  note: (id, issue) => {
    const next = { ...get().issues };
    if (issue) next[id] = issue;
    else if (!(id in next)) return; // nothing to clear — do not churn storage or re-render
    else delete next[id];
    writeIssues(next);
    set({ issues: next });
  },
  prune: (keep) => {
    const current = get().issues;
    const next = Object.fromEntries(Object.entries(current).filter(([id]) => keep.has(id)));
    if (Object.keys(next).length === Object.keys(current).length) return;
    writeIssues(next);
    set({ issues: next });
  },
}));

function writeIssues(v: Record<string, UploadIssue>): void {
  try {
    localStorage.setItem(ISSUE_KEY, JSON.stringify(v));
  } catch {
    // ignore storage failures
  }
}

/** Record an outcome against a book, or clear it. `sync-off` is a choice, not a problem; `signed-out` is
 *  the normal state of an anonymous user and only an anomaly for someone the store thinks IS signed in
 *  (a refresh that will not complete). */
function noteOutcome(id: string, outcome: UploadOutcome): void {
  // `no-file` clears too: with no local bytes this device has nothing to say about the book, and any
  // marker it recorded earlier (before an OPFS eviction, say) has stopped being true.
  if (outcome === 'ok' || outcome === 'sync-off' || outcome === 'no-file') return useBookUploadIssues.getState().note(id, null);
  if (outcome === 'signed-out' && useAccount.getState().status !== 'authenticated') return;
  useBookUploadIssues.getState().note(id, outcome);
}

/** Upload one book's OPFS file. Returns an outcome (rather than throwing) so the import path can fire it
 *  and forget, while the bulk sync can stop on `quota`. Skips when the toggle is off or the file is >20 MB.
 *  Recording happens HERE rather than at the call sites, so neither of them can forget to. */
export async function uploadBookFile(id: string): Promise<UploadOutcome> {
  const outcome = await attemptUpload(id);
  noteOutcome(id, outcome);
  return outcome;
}

async function attemptUpload(id: string): Promise<UploadOutcome> {
  if (!useBookFileSync.getState().enabled) return 'sync-off';
  const t = await token().catch(() => null); // getAccessToken can reject, not only resolve null
  if (!t) return 'signed-out';
  // Probed OUTSIDE the try: book metadata syncs unconditionally while the bytes do not, so every book
  // added on another device is a row here with no file. Letting that throw into the catch below reported
  // it as `error` — "we will try again automatically" on a device that can never succeed, about a file
  // another device owes. BookReaderPage already says the true thing for this case (`not-uploaded`).
  const file = await getBookFile(id).catch(() => null);
  if (!file) return 'no-file';
  try {
    if (file.size > BLOB_MAX_BYTES) return 'too-large'; // permanent: every later sweep skips it too
    const target = await api.blobUploadUrl(t, id, file.size);
    await api.blobUpload(t, target, file);
    await api.blobCommit(t, id, target.key, file.size);
    return 'ok';
  } catch (e) {
    if (!(e instanceof ApiFailure)) return 'error';
    return e.code === 'quota_exceeded' ? 'quota' : e.code === 'no_plan' ? 'no-plan' : 'error';
  }
}

/**
 * Why this device has no readable file for a book. Every one of these used to collapse into one silent
 * catch and one blanket "could not open the book", which is how a whole feature could sit broken in
 * production without anybody being able to say what was wrong.
 */
export type BookFileIssue =
  /** No usable session — the file may well be in the cloud, we just cannot ask for it. */
  | 'signed-out'
  /** The cloud has no copy: never uploaded from the device the book was added on, or uploaded and not
   *  committed. The bytes must come from THAT device; nothing this device does can conjure them. */
  | 'not-uploaded'
  | 'offline'
  /** Reached the server but the transfer failed — an expired presigned link, a 5xx. Worth retrying. */
  | 'download-failed'
  /** The bytes arrived and could not be stored here. */
  | 'no-space';

/** Fetch the cloud copy if this device lacks the file. Returns null once a readable file is present. */
export async function downloadBookFileIfMissing(id: string): Promise<BookFileIssue | null> {
  try {
    await getBookFile(id);
    return null; // already local
  } catch {
    // not local — try the cloud copy
  }
  const t = await token();
  if (!t) return 'signed-out';
  let blob: Blob;
  try {
    const url = await api.blobDownloadUrl(t, id);
    blob = await api.blobDownload(t, url);
  } catch (e) {
    if (!(e instanceof ApiFailure)) return 'download-failed';
    if (e.code === 'network') return 'offline';
    // A stale access token survives `refresh()` swallowing a network error, so 401 arrives with a
    // non-null token in hand — "signed out" from the server's point of view, not from ours.
    if (e.status === 401) return 'signed-out';
    return e.code === 'blob_not_found' ? 'not-uploaded' : 'download-failed';
  }
  try {
    await saveBookFile(id, blob);
    return null;
  } catch {
    return 'no-space';
  }
}

/** Delete a book's cloud blob (releasing its quota). Runs on removal regardless of the toggle. */
export async function deleteRemoteBookFile(id: string): Promise<void> {
  const t = await token();
  if (!t) return;
  await api.blobDelete(t, id).catch(() => undefined);
}

/** Upload every local book file not already in the cloud. Idempotent: it lists what the cloud holds
 *  first, so it doubles as the retry for an import-time upload that failed. */
export async function syncAllBookFiles(): Promise<void> {
  if (!useBookFileSync.getState().enabled) return;
  const t = await token();
  if (!t) return;
  // A failed listing used to read as an empty one, i.e. "the cloud holds nothing" — so every book was
  // re-uploaded, up to 20 MB each, on whatever connection the user happened to be on.
  const remote = await api
    .blobList(t)
    .then((r) => new Set(r.blobs.map((b) => b.bookId)))
    .catch(() => null);
  if (!remote) return;
  const books = await db.books.toArray();
  useBookUploadIssues.getState().prune(new Set(books.filter((b) => !isDeleted(b)).map((b) => b.id)));
  const live = books.filter((b) => !isDeleted(b));
  // Already in the cloud, so nothing to upload — but a book that failed once and landed later takes this
  // branch, and would otherwise keep its marker for the life of the install.
  for (const b of live) if (remote.has(b.id)) useBookUploadIssues.getState().note(b.id, null);

  const pending = live.filter((b) => !remote.has(b.id));
  for (const [i, b] of pending.entries()) {
    const outcome = await uploadBookFile(b.id);
    // Both are answers about the ACCOUNT, not about this file, so every remaining book has the same one.
    // Stop asking — but record it on all of them: leaving them bare would say "fine" about books that are
    // not, and leaving a stale `error` would promise a retry that cannot help.
    if (outcome === 'quota' || outcome === 'no-plan') {
      for (const rest of pending.slice(i + 1)) useBookUploadIssues.getState().note(rest.id, outcome);
      break;
    }
  }
}
