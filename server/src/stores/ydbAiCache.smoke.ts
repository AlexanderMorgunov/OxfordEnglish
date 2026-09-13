/**
 * Live smoke for YdbAiCacheStore. See ydbAuth.smoke.ts for the env recipe.
 * Checks what the in-memory store cannot: that a completion survives the YDB round-trip byte-for-byte,
 * including the Cyrillic and newlines every RU task returns.
 */
import { randomBytes } from 'node:crypto';
import { YdbAiCacheStore } from './ydbAiCache.js';
import { driver, query, TypedValues as T } from '../ydb.js';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail += 1;
};

const s = new YdbAiCacheStore();
const KEY = 'smoke-' + randomBytes(12).toString('base64url');
const CONTENT = 'Старый рыбак поел.\nПотом он пошёл домой — «очень устал».';

check('missing key → null', (await s.get(KEY)) === null);

await s.put(KEY, 'translate', CONTENT);
check('completion round-trips byte-for-byte (Cyrillic + newlines)', (await s.get(KEY)) === CONTENT);

await s.put(KEY, 'translate', 'replaced');
check('re-put overwrites', (await s.get(KEY)) === 'replaced');

const [rows] = await query('DECLARE $k AS Utf8; SELECT task, created_at FROM ai_cache WHERE cache_key=$k;', { $k: T.utf8(KEY) });
check('task and created_at are stored (TTL needs created_at)', rows[0]?.task === 'translate' && rows[0]?.created_at != null);

const desc = await (await driver()).tableClient.withSession((sess) => sess.describeTable('ai_cache'));
check('TTL is configured on created_at', desc.ttlSettings?.dateTypeColumn?.columnName === 'created_at');

await query('DECLARE $k AS Utf8; DELETE FROM ai_cache WHERE cache_key=$k;', { $k: T.utf8(KEY) });
check('cleanup removed the test row', (await s.get(KEY)) === null);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
process.exit(fail ? 1 : 0);
