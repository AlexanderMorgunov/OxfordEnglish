import { z } from 'zod';
import { db, type GameRecord } from '@/db/db';
import { LearningSchema, SaveWriteSchema } from './contract';
import { recordKey, type GameScope } from './storage';

const PortableRecord = z
  .object({
    gameId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
    kind: z.enum(['save', 'learning', 'time']),
    key: z.string().min(1).max(100),
    value: z.unknown(),
  })
  .strict();
export async function exportGameRecords(scope: GameScope) {
  const rows = await db.gameRecords
    .where('owner')
    .equals(scope.owner)
    .toArray();
  scope.check();
  return rows.map((r) => ({
    gameId: r.gameId,
    kind: r.kind,
    key: r.kind === 'time' ? r.id : String((JSON.parse(r.id) as string[])[3]),
    value: r.value,
  }));
}
export function parseGameRecords(raw: unknown, owner: string): GameRecord[] {
  const records = z
    .array(PortableRecord)
    .max(100000)
    .parse(raw ?? []);
  return records.map((record) => {
    let value: unknown;
    if (record.kind === 'save') {
      const original = z
        .object({ schemaVersion: z.number(), payload: z.unknown() })
        .parse(record.value);
      const request = SaveWriteSchema.parse({
        slotId: record.key,
        schemaVersion: original.schemaVersion,
        payload: original.payload,
        operationId: crypto.randomUUID(),
        baseRevision: 0,
      });
      value = {
        revision: 1,
        operationId: request.operationId,
        schemaVersion: request.schemaVersion,
        payload: request.payload,
        cloudRevision: 0,
        dirty: true,
      };
    } else if (record.kind === 'learning') {
      value = z
        .object({
          event: LearningSchema,
          ts: z.number().finite().nonnegative(),
        })
        .parse(record.value);
      if (
        (value as { event: { eventId: string } }).event.eventId !== record.key
      )
        throw new Error('Invalid game event identity');
    } else {
      z.string().uuid().parse(record.key);
      value = z
        .object({
          start: z.number().finite().nonnegative(),
          end: z.number().finite().nonnegative(),
        })
        .refine((i) => i.end > i.start && i.end - i.start <= 10000)
        .parse(record.value);
    }
    return {
      id:
        record.kind === 'time'
          ? record.key
          : recordKey(owner, record.gameId, record.kind, record.key),
      owner,
      gameId: record.gameId,
      kind: record.kind,
      value,
    };
  });
}
