import { db } from './db';

export async function adoptGuestGameRecords(
  accountId: string,
  current: () => boolean
): Promise<void> {
  await db.transaction('rw', db.gameRecords, async () => {
    const rows = await db.gameRecords.where('owner').equals('guest').toArray();
    for (const row of rows) {
      if (!current()) throw new Error('Account changed');
      const parts: unknown = row.kind === 'time' ? null : JSON.parse(row.id);
      const id =
        Array.isArray(parts) && parts.length === 4
          ? JSON.stringify([accountId, ...parts.slice(1)])
          : row.id;
      if (id !== row.id && (await db.gameRecords.get(id))) continue;
      await db.gameRecords.put({ ...row, id, owner: accountId });
      if (id !== row.id) await db.gameRecords.delete(row.id);
    }
    if (!current()) throw new Error('Account changed');
  });
}
