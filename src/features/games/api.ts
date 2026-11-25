import { z } from 'zod';
import { db } from '@/db/db';
import { API_BASE } from '@/features/account/config';
import { captureAccountSessionOwner, useAccount } from '@/features/account/store';
import { invalidateGameAvailability } from './availability';
import { GameFailure, GameManifestSchema } from './contract';
import { loadSave, recordKey, type GameScope, type SavedGame } from './storage';

export async function gameApi(
  path: string,
  init: RequestInit = {},
  scope?: GameScope
): Promise<unknown> {
  if (!API_BASE) throw new GameFailure('unavailable');
  const current = captureAccountSessionOwner();
  scope?.check();
  const token = await useAccount.getState().getAccessToken();
  if (!current()) throw new GameFailure('stale_owner');
  if (useAccount.getState().status === 'authenticated' && !token)
    throw new GameFailure('unauthorized');
  scope?.check();
  const signal = AbortSignal.any([
    AbortSignal.timeout(15000),
    ...(init.signal ? [init.signal] : []),
  ]);
  const response = await fetch(`${API_BASE}/v1/games${path}`, {
    ...init,
    cache: 'no-store',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }).catch(() => {
    throw new GameFailure('offline');
  });
  scope?.check();
  const data: unknown = await response.json();
  scope?.check();
  if (!current() || signal.aborted) throw new GameFailure('cancelled');
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ code: z.string() }) })
      .safeParse(data);
    const code = error.success ? error.data.error.code : 'unavailable';
    if (response.status === 403 && code === 'feature_unavailable') invalidateGameAvailability();
    throw new GameFailure(code);
  }
  return data;
}
export async function loadCatalog(signal?: AbortSignal) {
  const data = await gameApi('/catalog', { signal });
  return z
    .object({
      version: z.literal(1),
      games: z.array(GameManifestSchema).max(50),
    })
    .parse(data).games;
}
const CloudSaveSchema = z.object({
  revision: z.number().int().positive(),
  operationId: z.string().uuid(),
  schemaVersion: z.number().int().positive(),
  payload: z.unknown(),
});
export async function readCloudConflict(
  scope: GameScope,
  gameId: string,
  slot: string
) {
  const local = await loadSave(scope, gameId, slot);
  const remote = z
    .object({ save: CloudSaveSchema.nullable() })
    .parse(await gameApi(`/${gameId}/saves/${slot}`, {}, scope)).save;
  if (!local || !remote) throw new GameFailure('not_found');
  return { local, remote };
}
export type CloudConflict = Awaited<ReturnType<typeof readCloudConflict>>;
export async function resolveCloudConflict(
  scope: GameScope,
  gameId: string,
  slot: string,
  conflict: CloudConflict,
  choice: 'local' | 'cloud'
) {
  if (useAccount.getState().accountId !== scope.owner)
    throw new GameFailure('unauthorized');
  const { local, remote } = conflict;
  let backupSlot = '';
  await db.transaction('rw', db.gameRecords, async () => {
    const now = await loadSave(scope, gameId, slot);
    if (
      now?.revision !== local.revision ||
      now.operationId !== local.operationId
    )
      throw new GameFailure('conflict');
    for (let i = 0; i < 8; i++)
      if (String(i) !== slot && !(await loadSave(scope, gameId, String(i)))) {
        backupSlot = String(i);
        break;
      }
    if (!backupSlot) throw new GameFailure('no_backup_slot');
    const copy = choice === 'cloud' ? local : remote;
    scope.check();
    await db.gameRecords.add({
      id: recordKey(scope.owner, gameId, 'save', backupSlot),
      owner: scope.owner,
      gameId,
      kind: 'save',
      value: {
        ...copy,
        revision: 1,
        cloudRevision: 0,
        dirty: true,
        operationId: crypto.randomUUID(),
      },
    });
  });
  const next =
    choice === 'cloud'
      ? remote
      : z.object({ save: CloudSaveSchema }).parse(
          await gameApi(
            `/${gameId}/saves/${slot}`,
            {
              method: 'PUT',
              body: JSON.stringify({
                baseRevision: remote.revision,
                schemaVersion: local.schemaVersion,
                payload: local.payload,
                operationId: crypto.randomUUID(),
              }),
            },
            scope
          )
        ).save;
  await db.transaction('rw', db.gameRecords, async () => {
    const now = await loadSave(scope, gameId, slot);
    if (
      now?.revision !== local.revision ||
      now.operationId !== local.operationId
    )
      throw new GameFailure('conflict');
    scope.check();
    await db.gameRecords.put({
      id: recordKey(scope.owner, gameId, 'save', slot),
      owner: scope.owner,
      gameId,
      kind: 'save',
      value: {
        ...next,
        revision: local.revision + 1,
        cloudRevision: next.revision,
        dirty: false,
      },
    });
  });
  return {
    status: 'synced',
    revision: local.revision + 1,
    backupSlotId: backupSlot,
  };
}
export async function syncSave(
  scope: GameScope,
  gameId: string,
  slot: string,
  direction: 'push' | 'pull',
  signal?: AbortSignal
) {
  const account = useAccount.getState();
  if (!account.accountId || scope.owner !== account.accountId)
    throw new GameFailure('unauthorized');
  const before = await loadSave(scope, gameId, slot);
  if (direction === 'pull' && before?.dirty) throw new GameFailure('conflict');
  if (direction === 'push' && !before) return { revision: 0, status: 'empty' };
  if (direction === 'push' && before && !before.dirty)
    return { revision: before.revision, status: 'synced' };
  const data = await gameApi(
    `/${gameId}/saves/${slot}`,
    direction === 'pull'
      ? { signal }
      : {
          method: 'PUT',
          signal,
          body: JSON.stringify({
            baseRevision: before!.cloudRevision,
            operationId: before!.operationId,
            schemaVersion: before!.schemaVersion,
            payload: before!.payload,
          }),
        },
    scope
  );
  const { save } = z.object({ save: CloudSaveSchema.nullable() }).parse(data);
  if (!save) return { revision: before?.revision ?? 0, status: 'empty' };
  return db.transaction('rw', db.gameRecords, async () => {
    const now = await loadSave(scope, gameId, slot);
    if (
      now?.revision !== before?.revision ||
      now?.operationId !== before?.operationId
    )
      throw new GameFailure('conflict');
    scope.check();
    const value: SavedGame = {
      ...save,
      payload: save.payload,
      revision:
        direction === 'push' ? before!.revision : (before?.revision ?? 0) + 1,
      cloudRevision: save.revision,
      dirty: false,
    };
    await db.gameRecords.put({
      id: recordKey(scope.owner, gameId, 'save', slot),
      owner: scope.owner,
      gameId,
      kind: 'save',
      value,
    });
    scope.check();
    return { revision: value.revision, status: 'synced' };
  });
}
