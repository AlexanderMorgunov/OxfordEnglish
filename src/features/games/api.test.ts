import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { gameScope, loadSave, writeSave } from './storage';
import { readCloudConflict, resolveCloudConflict, syncSave } from './api';

vi.mock('@/features/account/config', () => ({ API_BASE: 'https://api.test' }));
vi.mock('@/features/account/store', () => ({
  localDataOwner: () => 'owner',
  captureAccountSessionOwner: () => () => true,
  useAccount: {
    getState: () => ({
      accountId: 'owner',
      getAccessToken: async () => 'test-token',
    }),
  },
}));
const remote = {
  revision: 4,
  operationId: crypto.randomUUID(),
  schemaVersion: 1,
  payload: { step: 9 },
};
const scope = () => gameScope();
const input = (slotId = '0', baseRevision = 0) => ({
  slotId,
  baseRevision,
  operationId: crypto.randomUUID(),
  schemaVersion: 1,
  payload: { step: 3 },
});
beforeEach(async () => {
  await db.gameRecords.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ save: remote }))
  );
});
afterEach(() => vi.unstubAllGlobals());

it('requires conflict resolution instead of overwriting an unsent local save', async () => {
  await writeSave(scope(), 'test', input());
  await expect(syncSave(scope(), 'test', '0', 'pull')).rejects.toThrow(
    'conflict'
  );
  expect(fetch).not.toHaveBeenCalled();
  expect((await loadSave(scope(), 'test', '0'))?.payload).toEqual({ step: 3 });
});

it('keeps a backup when the user chooses the cloud copy', async () => {
  await writeSave(scope(), 'test', input());
  const snapshot = await readCloudConflict(scope(), 'test', '0');
  const result = await resolveCloudConflict(
    scope(),
    'test',
    '0',
    snapshot,
    'cloud'
  );
  expect(result.backupSlotId).toBe('1');
  expect(await loadSave(scope(), 'test', '0')).toMatchObject({
    payload: { step: 9 },
    cloudRevision: 4,
    dirty: false,
  });
  expect(await loadSave(scope(), 'test', '1')).toMatchObject({
    payload: { step: 3 },
    cloudRevision: 0,
    dirty: true,
  });
});

it('preserves both copies if the plan expires during a local choice', async () => {
  await writeSave(scope(), 'test', input());
  const snapshot = await readCloudConflict(scope(), 'test', '0');
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: { code: 'no_plan' } }, { status: 402 })
  );
  await expect(
    resolveCloudConflict(scope(), 'test', '0', snapshot, 'local')
  ).rejects.toThrow('no_plan');
  expect((await loadSave(scope(), 'test', '0'))?.payload).toEqual({ step: 3 });
  expect((await loadSave(scope(), 'test', '1'))?.payload).toEqual({ step: 9 });
});

it('rejects a stale dialog or a full set of slots without replacing saves', async () => {
  await writeSave(scope(), 'test', input());
  const snapshot = await readCloudConflict(scope(), 'test', '0');
  await writeSave(scope(), 'test', input('0', 1));
  await expect(
    resolveCloudConflict(scope(), 'test', '0', snapshot, 'cloud')
  ).rejects.toThrow('conflict');
  for (let i = 1; i < 8; i++)
    await writeSave(scope(), 'test', input(String(i)));
  const latest = await readCloudConflict(scope(), 'test', '0');
  await expect(
    resolveCloudConflict(scope(), 'test', '0', latest, 'cloud')
  ).rejects.toThrow('no_backup_slot');
  expect(await db.gameRecords.count()).toBe(8);
});

it('does not overwrite a local write made while a cloud response was in flight', async () => {
  await writeSave(scope(), 'test', input());
  vi.mocked(fetch).mockImplementationOnce(async () => {
    await writeSave(scope(), 'test', {
      ...input('0', 1),
      payload: { step: 5 },
    });
    return Response.json({ save: remote });
  });
  await expect(syncSave(scope(), 'test', '0', 'push')).rejects.toThrow(
    'conflict'
  );
  expect(await loadSave(scope(), 'test', '0')).toMatchObject({
    payload: { step: 5 },
    dirty: true,
  });
});
