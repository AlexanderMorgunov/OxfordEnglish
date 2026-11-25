import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import {
  gameScope,
  loadSave,
  recordLearning,
  unionDuration,
  writeSave,
  swapBackupSave,
} from './storage';
import { SaveWriteSchema, LearningSchema } from './contract';

vi.mock('@/features/account/store', () => ({
  localDataOwner: () => 'test-owner',
  captureAccountSessionOwner: () => () => true,
}));
beforeEach(async () => {
  await db.gameRecords.clear();
});
describe('game saves', () => {
  it('restores a backup atomically and keeps the previous main checkpoint', async () => {
    const scope = gameScope();
    await writeSave(scope, 'lumi', {
      slotId: '0',
      baseRevision: 0,
      operationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: { chapter: 2 },
    });
    await writeSave(scope, 'lumi', {
      slotId: '3',
      baseRevision: 0,
      operationId: crypto.randomUUID(),
      schemaVersion: 2,
      payload: { chapter: 1 },
    });
    await swapBackupSave(scope, 'lumi', '3');
    expect(await loadSave(scope, 'lumi', '0')).toMatchObject({
      payload: { chapter: 1 },
      schemaVersion: 2,
      revision: 2,
      dirty: true,
    });
    expect(await loadSave(scope, 'lumi', '3')).toMatchObject({
      payload: { chapter: 2 },
      schemaVersion: 1,
      revision: 2,
    });
    await expect(swapBackupSave(scope, 'lumi', '7')).rejects.toThrow(
      'not_found'
    );
    await expect(swapBackupSave(scope, 'lumi', '0')).rejects.toThrow(
      'not_found'
    );
    expect((await loadSave(scope, 'lumi', '0'))?.payload).toEqual({
      chapter: 1,
    });
    invalidateDataScope();
    await expect(swapBackupSave(scope, 'lumi', '3')).rejects.toThrow(
      'stale_owner'
    );
  });
  it('persists once on retry and rejects a stale competing write', async () => {
    const scope = gameScope();
    const input = {
      slotId: '0',
      baseRevision: 0,
      operationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: { step: 2 },
    };
    expect(await writeSave(scope, 'test', input)).toEqual({
      revision: 1,
      status: 'local_saved',
    });
    expect(await writeSave(scope, 'test', input)).toEqual({
      revision: 1,
      status: 'local_saved',
    });
    await expect(
      writeSave(scope, 'test', { ...input, payload: { step: 9 } })
    ).rejects.toThrow('conflict');
    await expect(
      writeSave(scope, 'test', { ...input, operationId: crypto.randomUUID() })
    ).rejects.toThrow('conflict');
    expect((await loadSave(scope, 'test', '0'))?.payload).toEqual({ step: 2 });
    expect(await loadSave(scope, 'other', '0')).toBeNull();
  });
  it('does not allow a delayed save after ownership invalidation', async () => {
    const scope = gameScope();
    invalidateDataScope();
    await expect(
      writeSave(scope, 'test', {
        slotId: '0',
        baseRevision: 0,
        operationId: crypto.randomUUID(),
        schemaVersion: 1,
        payload: {},
      })
    ).rejects.toThrow('stale_owner');
    expect(await db.gameRecords.count()).toBe(0);
  });
  it('allows only bounded JSON saves and fixed save slots', () => {
    const input = {
      slotId: '0',
      baseRevision: 0,
      operationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: {},
    };
    expect(
      SaveWriteSchema.safeParse({ ...input, slotId: '../x' }).success
    ).toBe(false);
    expect(
      SaveWriteSchema.safeParse({ ...input, payload: 'a'.repeat(262145) })
        .success
    ).toBe(false);
    expect(
      SaveWriteSchema.safeParse({ ...input, payload: undefined }).success
    ).toBe(false);
  });
});
it('deduplicates learning delivery but rejects payload reuse', async () => {
  const event = LearningSchema.parse({
    eventId: crypto.randomUUID(),
    activityId: 'a',
    itemVersion: '1',
    runId: 'r',
    attemptNumber: 1,
    skills: ['grammar.past-simple'],
    correct: true,
    usedAI: false,
    usedHint: false,
  });
  expect(await recordLearning(gameScope(), 'test', event)).toEqual({
    status: 'recorded',
  });
  expect(await recordLearning(gameScope(), 'test', event)).toEqual({
    status: 'existing',
  });
  await expect(
    recordLearning(gameScope(), 'test', { ...event, correct: false })
  ).rejects.toThrow('conflict');
});
it('does not double count overlapping sessions or a sleeping timer', () => {
  expect(
    unionDuration([
      { start: 1000, end: 6000 },
      { start: 3000, end: 8000 },
      { start: 1000, end: 900000 },
    ])
  ).toBe(7000);
});
