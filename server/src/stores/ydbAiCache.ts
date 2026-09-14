/**
 * Cross-user AI cache on YDB: `ai_cache(cache_key PK, task, content, created_at)`.
 *
 * Account-free by design — the key is a hash of (task, prompt version, model, inputs) and nothing here
 * ties a completion to who asked for it. That is also why there is no per-row hit counter: attributing
 * hits is the step that would turn this into a record of what each user read.
 *
 * TTL'd rather than kept forever: a prompt-version bump already orphans old rows, and the economic value
 * sits in the hot set (shared packs and catalog books), not the long tail.
 */
import type { AiCacheStore } from '../ai.js';
import type { AiTaskName } from '../contract.js';
import { query, TypedValues as T } from '../ydb.js';

export const AI_CACHE_TTL_DAYS = 180;

const str = (v: unknown): string => (v == null ? '' : String(v));

export class YdbAiCacheStore implements AiCacheStore {
  async get(key: string): Promise<string | null> {
    const [rows] = await query('DECLARE $k AS Utf8; SELECT content FROM ai_cache WHERE cache_key=$k;', {
      $k: T.utf8(key),
    });
    return rows[0]?.content == null ? null : str(rows[0].content);
  }

  async put(key: string, task: AiTaskName, content: string): Promise<void> {
    await query(
      'DECLARE $k AS Utf8; DECLARE $t AS Utf8; DECLARE $c AS Utf8; DECLARE $ts AS Timestamp;' +
        'UPSERT INTO ai_cache (cache_key, task, content, created_at) VALUES ($k, $t, $c, $ts);',
      { $k: T.utf8(key), $t: T.utf8(task), $c: T.utf8(content), $ts: T.timestamp(new Date()) }
    );
  }
}
