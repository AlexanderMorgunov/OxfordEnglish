import { Hono } from 'hono';
import { ErrorCode, AiTaskRequestSchema, AI_MAX_INPUT_CHARS } from '../contract.js';
import { bearerClaims } from '../tokens.js';
import { consumeAi, refundAi, evaluate, type EntitlementStore } from '../entitlements.js';
import { TASKS, aiCost, buildMessages, cacheKey, inputSize, type AiCacheStore } from '../ai.js';
import { deepseekCompleter, aiConfigured, AI_MODEL, type Completer } from '../aiProvider.js';

const err = (code: string, status: 400 | 401 | 402 | 413 | 429 | 503) =>
  Response.json({ error: { code } }, { status });

/**
 * `POST /v1/ai` — the managed-AI path for paid/trial accounts.
 *
 * Order matters: reject oversized input before spending anything, charge the quota BEFORE doing work
 * (so concurrent requests can't both pass a nearly-empty budget), then try the shared cache, then the
 * upstream. A failed upstream call is refunded; a cache hit is NOT free (see AI_COST_PER_CALL).
 */
export function aiRoutes(ent: EntitlementStore, cache: AiCacheStore, completer: Completer = deepseekCompleter): Hono {
  const app = new Hono();

  app.post('/v1/ai', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    if (!aiConfigured()) return err(ErrorCode.AiUnavailable, 503);

    const body = AiTaskRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const req = body.data;
    if (inputSize(req) > AI_MAX_INPUT_CHARS) return err(ErrorCode.InputTooLarge, 413);

    const now = Date.now();
    const cost = aiCost(req.task);
    const charge = consumeAi(await ent.get(claims.sub), now, cost);
    if (!charge.allowed) {
      return charge.reason === 'no_plan' ? err(ErrorCode.NoPlan, 402) : err(ErrorCode.QuotaExhausted, 429);
    }
    await ent.put(charge.row);

    const spec = TASKS[req.task];
    const key = spec.cacheable ? cacheKey(req, AI_MODEL) : null;
    if (key) {
      const hit = await cache.get(key);
      if (hit) return c.json({ content: hit, cached: true, ai: charge.entitlement.ai });
    }

    let content: string;
    try {
      content = await completer(buildMessages(req), {
        temperature: spec.temperature,
        maxTokens: spec.maxTokens,
        task: req.task,
      });
    } catch {
      const refunded = refundAi(await ent.get(claims.sub), cost);
      if (refunded) await ent.put(refunded);
      return err(ErrorCode.AiUnavailable, 503);
    }

    if (key) await cache.put(key, req.task, content);
    return c.json({ content, cached: false, ai: evaluate(charge.row, now).ai });
  });

  return app;
}
