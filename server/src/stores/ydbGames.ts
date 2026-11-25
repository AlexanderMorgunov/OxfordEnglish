import {
  advanceSave,
  type GameSave,
  type GameStore,
  type SaveWrite,
} from '../games.js';
import { query, withSerializableTx, TypedValues as T } from '../ydb.js';

const read =
  'DECLARE $a AS Utf8; DECLARE $k AS Utf8; SELECT payload FROM game_saves WHERE account_id=$a AND save_key=$k;';
const params = (account: string, game: string, slot: string) => ({
  $a: T.utf8(account),
  $k: T.utf8(`${game}/${slot}`),
});
const decode = (rows: Record<string, unknown>[]): GameSave | null =>
  rows[0]?.payload == null ? null : JSON.parse(String(rows[0].payload));
export class YdbGameStore implements GameStore {
  async get(account: string, game: string, slot: string) {
    const [rows] = await query(read, params(account, game, slot));
    return decode(rows);
  }
  async put(account: string, game: string, slot: string, request: SaveWrite) {
    return withSerializableTx(async (tx) => {
      const p = params(account, game, slot);
      const [rows] = await tx.exec(read, p);
      const next = advanceSave(decode(rows), request);
      if (!next) {
        await tx.exec('SELECT 1;', {}, true);
        return null;
      }
      await tx.exec(
        'DECLARE $a AS Utf8; DECLARE $k AS Utf8; DECLARE $p AS Utf8; UPSERT INTO game_saves (account_id, save_key, payload) VALUES ($a, $k, $p);',
        { ...p, $p: T.utf8(JSON.stringify(next)) },
        true
      );
      return next;
    });
  }
  async purge(account: string) {
    try {
      await query(
        'DECLARE $a AS Utf8; DELETE FROM game_saves WHERE account_id=$a;',
        { $a: T.utf8(account) }
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /(?:path|table).*(?:does not exist|not found)|(?:cannot find|unknown) table/i.test(
          error.message
        )
      )
        return;
      throw error;
    }
  }
}
