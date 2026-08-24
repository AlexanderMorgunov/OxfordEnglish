import { db, type Bookmark, type SrsCard } from '@/db/db';
import { reviveCard, stripId } from '@/features/progress/backup';

export const SNAPSHOT_VERSION = 1;

const CATALOG_PREFIX = 'reader.catalog.';

// localStorage keys that carry portable user state (migration plan §2). `oxford-ai-config` is
// handled separately (its apiKey is stripped); analytics.anonId/firstSeen are deliberately excluded.
const PORTABLE_LOCAL_KEYS = [
  'oxford-learner',
  'oxford-reader-settings',
  'oxford-ui-lang',
  'analytics.optOut',
  'onboarding.seen',
] as const;

export type SnapshotDexie = {
  attempts?: unknown[];
  checkpoints?: unknown[];
  wordStatus?: unknown[];
  srsCards?: SrsCard[];
  translations?: unknown[];
  bookmarks?: Bookmark[];
  feedbackOutbox?: unknown[];
};

export type Snapshot = {
  snapshotVersion: number;
  dexieVersion: number;
  appVersion: string;
  createdAt: number;
  dexie: SnapshotDexie;
  local: Record<string, string>;
  booksCount: number;
  /** Where to land on `.ru` after import — the path the user opened on `.online`. Migration-only. */
  dest?: string;
};

function collectLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PORTABLE_LOCAL_KEYS) {
    const v = localStorage.getItem(key);
    if (v != null) out[key] = v;
  }
  // AI config travels WITHOUT the apiKey — a secret must never ride in a URL fragment.
  const ai = localStorage.getItem('oxford-ai-config');
  if (ai != null) {
    try {
      const cfg = JSON.parse(ai) as Record<string, unknown>;
      delete cfg.apiKey;
      out['oxford-ai-config'] = JSON.stringify(cfg);
    } catch {
      // malformed config — skip it rather than fail the whole snapshot
    }
  }
  // Per-chapter scroll positions, catalog books only (imported books aren't migrated in v1).
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CATALOG_PREFIX) && key.includes('.pos.')) {
      const v = localStorage.getItem(key);
      if (v != null) out[key] = v;
    }
  }
  return out;
}

/** Serialize this origin's portable state. `includeHistory:false` drops attempts/checkpoints
 *  (non-user-visible telemetry) to shrink the payload for the size-bounded transport. */
export async function buildSnapshot(opts: { includeHistory?: boolean } = {}): Promise<Snapshot> {
  const includeHistory = opts.includeHistory ?? true;
  const [attempts, checkpoints, wordStatus, srsCards, translations, bookmarks, feedbackOutbox, booksCount] =
    await Promise.all([
      includeHistory ? db.attempts.toArray() : Promise.resolve([]),
      includeHistory ? db.checkpoints.toArray() : Promise.resolve([]),
      db.wordStatus.toArray(),
      db.srsCards.toArray(),
      db.translations.toArray(),
      db.bookmarks.toArray(),
      db.feedbackOutbox.toArray(),
      db.books.count(),
    ]);
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    dexieVersion: db.verno,
    appVersion: __APP_VERSION__,
    createdAt: Date.now(),
    dexie: {
      attempts,
      checkpoints,
      wordStatus,
      srsCards,
      translations,
      // Catalog bookmarks rematch by stable key; imported-book ones (reader.<uuid>) are dropped
      // since imported books aren't migrated in v1.
      bookmarks: bookmarks.filter((b) => b.bookKey.startsWith(CATALOG_PREFIX)),
      feedbackOutbox,
    },
    local: collectLocal(),
    booksCount,
  };
}

export type ApplyResult = 'imported' | 'skipped-nonempty';

/** True when this origin already holds real progress — the guard against clobbering a live user. */
export async function hasProgress(): Promise<boolean> {
  const [srs, words] = await Promise.all([db.srsCards.count(), db.wordStatus.count()]);
  return srs > 0 || words > 0;
}

/** Import a snapshot into THIS origin's storage. Runs only into a fresh profile and never overwrites
 *  an existing localStorage key, so a partially set-up target user is left intact. */
export async function applySnapshot(s: Snapshot): Promise<ApplyResult> {
  if (await hasProgress()) return 'skipped-nonempty';
  const d = s.dexie;
  await db.transaction(
    'rw',
    [db.attempts, db.checkpoints, db.wordStatus, db.srsCards, db.translations, db.bookmarks, db.feedbackOutbox],
    async () => {
      // `++id` stores: append (never bulkPut-by-id, which would clobber). Guarded by hasProgress()
      // + the caller's idempotency flag so a re-run can't double-append.
      if (d.attempts?.length) await db.attempts.bulkAdd(stripId(d.attempts) as never);
      if (d.checkpoints?.length) await db.checkpoints.bulkAdd(stripId(d.checkpoints) as never);
      if (d.feedbackOutbox?.length) await db.feedbackOutbox.bulkAdd(stripId(d.feedbackOutbox) as never);
      if (d.wordStatus?.length) await db.wordStatus.bulkPut(d.wordStatus as never);
      if (d.srsCards?.length) await db.srsCards.bulkPut(d.srsCards.map(reviveCard));
      if (d.translations?.length) await db.translations.bulkPut(d.translations as never);
      if (d.bookmarks?.length) await db.bookmarks.bulkPut(d.bookmarks);
    }
  );
  for (const [key, value] of Object.entries(s.local)) {
    if (localStorage.getItem(key) == null) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // ignore storage failures
      }
    }
  }
  return 'imported';
}
