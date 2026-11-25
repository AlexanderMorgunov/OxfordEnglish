import { db } from '@/db/db';
import { captureDataScope } from '@/features/account/dataScope';
import {
  captureAccountSessionOwner,
  localDataOwner,
} from '@/features/account/store';
import { GameFailure, type Learning, type SaveWrite } from './contract';

export type SavedGame = {
  revision: number;
  schemaVersion: number;
  payload: unknown;
  operationId: string;
  cloudRevision: number;
  dirty: boolean;
};
export function gameScope() {
  const owner = localDataOwner();
  const dataCurrent = captureDataScope();
  const sessionCurrent = captureAccountSessionOwner();
  return {
    owner,
    check() {
      if (!dataCurrent() || !sessionCurrent() || owner !== localDataOwner())
        throw new GameFailure('stale_owner');
    },
  };
}
export type GameScope = ReturnType<typeof gameScope>;
export const recordKey = (
  owner: string,
  gameId: string,
  kind: string,
  id: string
) => JSON.stringify([owner, gameId, kind, id]);
export async function loadSave(
  scope: GameScope,
  gameId: string,
  slot: string
): Promise<SavedGame | null> {
  scope.check();
  const row = await db.gameRecords.get(
    recordKey(scope.owner, gameId, 'save', slot)
  );
  scope.check();
  return row ? (row.value as SavedGame) : null;
}
export async function writeSave(
  scope: GameScope,
  gameId: string,
  input: SaveWrite
) {
  return db.transaction('rw', db.gameRecords, async () => {
    const current = await loadSave(scope, gameId, input.slotId);
    if (current?.operationId === input.operationId) {
      if (
        current.revision !== input.baseRevision + 1 ||
        current.schemaVersion !== input.schemaVersion ||
        JSON.stringify(current.payload) !== JSON.stringify(input.payload)
      )
        throw new GameFailure('conflict');
      return { revision: current.revision, status: 'local_saved' as const };
    }
    if ((current?.revision ?? 0) !== input.baseRevision)
      throw new GameFailure('conflict');
    scope.check();
    const value: SavedGame = {
      revision: input.baseRevision + 1,
      operationId: input.operationId,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      cloudRevision: current?.cloudRevision ?? 0,
      dirty: true,
    };
    await db.gameRecords.put({
      id: recordKey(scope.owner, gameId, 'save', input.slotId),
      owner: scope.owner,
      gameId,
      kind: 'save',
      value,
    });
    scope.check();
    return { revision: value.revision, status: 'local_saved' as const };
  });
}
export async function swapBackupSave(
  scope: GameScope,
  gameId: string,
  slot: string
) {
  if (!/^[1-7]$/.test(slot)) throw new GameFailure('not_found');
  return db.transaction('rw', db.gameRecords, async () => {
    const backup = await loadSave(scope, gameId, slot);
    const current = await loadSave(scope, gameId, '0');
    if (!backup) throw new GameFailure('not_found');
    if (current)
      await writeSave(scope, gameId, {
        slotId: slot,
        baseRevision: backup.revision,
        operationId: crypto.randomUUID(),
        schemaVersion: current.schemaVersion,
        payload: current.payload,
      });
    await writeSave(scope, gameId, {
      slotId: '0',
      baseRevision: current?.revision ?? 0,
      operationId: crypto.randomUUID(),
      schemaVersion: backup.schemaVersion,
      payload: backup.payload,
    });
    scope.check();
    return { status: 'local_saved' as const };
  });
}

export async function recordLearning(
  scope: GameScope,
  gameId: string,
  event: Learning
) {
  return db.transaction('rw', db.gameRecords, async () => {
    scope.check();
    const id = recordKey(scope.owner, gameId, 'learning', event.eventId);
    const old = await db.gameRecords.get(id);
    scope.check();
    if (old) {
      const existing = old.value as { event: Learning };
      if (JSON.stringify(existing.event) !== JSON.stringify(event))
        throw new GameFailure('conflict');
      return { status: 'existing' as const };
    }
    await db.gameRecords.add({
      id,
      owner: scope.owner,
      gameId,
      kind: 'learning',
      value: { event, ts: Date.now() },
    });
    scope.check();
    return { status: 'recorded' as const };
  });
}
export async function recordTime(
  scope: GameScope,
  gameId: string,
  start: number,
  end: number
) {
  if (end <= start || end - start > 10000) return;
  scope.check();
  await db.transaction('rw', db.gameRecords, async () => {
    scope.check();
    await db.gameRecords.add({
      id: crypto.randomUUID(),
      owner: scope.owner,
      gameId,
      kind: 'time',
      value: { start, end },
    });
    scope.check();
  });
}
export function unionDuration(
  intervals: { start: number; end: number }[]
): number {
  let total = 0,
    last = 0;
  for (const i of intervals
    .filter(
      (i) =>
        Number.isFinite(i.start) &&
        Number.isFinite(i.end) &&
        i.end > i.start &&
        i.end - i.start <= 10000
    )
    .sort((a, b) => a.start - b.start)) {
    total += Math.max(0, i.end - Math.max(last, i.start));
    last = Math.max(last, i.end);
  }
  return total;
}
