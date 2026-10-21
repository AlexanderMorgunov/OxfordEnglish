import { db } from '@/db/db';
import { captureDataScope } from '@/features/account/dataScope';
import { currentInstallId, isSyncing } from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';
import { markDirty } from '@/features/sync/engine';
import { nudgeSync } from '@/features/sync/run';

export const BOOK_OPEN_PREFIX = 'book-open:';

export function openedAt(value: unknown): number {
  if (!value || typeof value !== 'object' || !('openedAt' in value)) return 0;
  const time = value.openedAt;
  return typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : 0;
}

export async function markBookOpened(
  id: string,
  now = Date.now(),
  current = captureDataScope()
): Promise<boolean> {
  try {
    const writer = await currentInstallId();
    const syncing = isSyncing();
    const saved = await db.transaction('rw', [db.books, db.settings, db.pending], async () => {
      if (!current()) return false;
      const book = await db.books.get(id);
      if (!book || isDeleted(book)) return false;
      const key = `${BOOK_OPEN_PREFIX}${id}`;
      const previous = await db.settings.get(key);
      if (!current()) return false;
      const timestamp = Math.max(now, (previous?.updatedAt ?? 0) + 1, openedAt(previous?.value) + 1);
      const row = { key, value: { openedAt: timestamp }, updatedAt: timestamp, updatedBy: writer };
      await db.settings.put(row);
      if (syncing) await markDirty('settings', row);
      return true;
    });
    if (saved && syncing && current()) nudgeSync();
    return saved;
  } catch {
    return false;
  }
}
