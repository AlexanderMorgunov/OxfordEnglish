import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { adoptGuestGameRecords } from '@/db/game-records';
import { exportGameRecords, parseGameRecords } from './backup';
import { loadSave, writeSave, type GameScope } from './storage';

vi.mock('@/features/account/store', () => ({
  localDataOwner: () => 'guest',
  captureAccountSessionOwner: () => () => true,
}));
const scope = (owner: string): GameScope => ({ owner, check() {} });
const input = () => ({
  slotId: '0',
  baseRevision: 0,
  operationId: crypto.randomUUID(),
  schemaVersion: 1,
  payload: { scene: 'one' },
});
beforeEach(async () => {
  await db.gameRecords.clear();
});

it('exports only the active owner and restores portable saves without old cloud revisions', async () => {
  await writeSave(scope('alice'), 'test', input());
  await writeSave(scope('bob'), 'test', input());
  const exported = await exportGameRecords(scope('alice'));
  expect(exported).toHaveLength(1);
  expect(JSON.stringify(exported)).not.toContain('alice');
  const restored = parseGameRecords(exported, 'carol');
  await db.gameRecords.bulkAdd(restored);
  expect(await loadSave(scope('carol'), 'test', '0')).toMatchObject({
    payload: { scene: 'one' },
    cloudRevision: 0,
    dirty: true,
  });
  expect(() =>
    parseGameRecords([{ ...exported[0], key: '99' }], 'carol')
  ).toThrow();
});

it('adopts guest work without touching another account or overwriting a collision', async () => {
  await writeSave(scope('guest'), 'test', input());
  await writeSave(scope('other'), 'test', input());
  await adoptGuestGameRecords('new', () => true);
  expect(await loadSave(scope('new'), 'test', '0')).not.toBeNull();
  expect(await loadSave(scope('guest'), 'test', '0')).toBeNull();
  expect(await loadSave(scope('other'), 'test', '0')).not.toBeNull();
  await writeSave(scope('guest'), 'test', input());
  await adoptGuestGameRecords('new', () => true);
  expect(await loadSave(scope('guest'), 'test', '0')).not.toBeNull();
});

it('rolls back guest adoption if the account changes', async () => {
  await writeSave(scope('guest'), 'test', input());
  let calls = 0;
  await expect(
    adoptGuestGameRecords('new', () => ++calls === 1)
  ).rejects.toThrow('Account changed');
  expect(await loadSave(scope('guest'), 'test', '0')).not.toBeNull();
  expect(await loadSave(scope('new'), 'test', '0')).toBeNull();
});
