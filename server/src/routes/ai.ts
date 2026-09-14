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
 * Order matters: reject oversized input before spending anything, charge the quota BEFORE doing work,
 * then try the shared cache, then the upstream. A failed upstream call is refunded; a cache hit is NOT
 * free (see AI_COST_PER_CALL). The charge and the refund each go through one atomic store mutation —
 * charging first only bounds spend if concurrent calls cannot all read the same pre-charge balance.
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
    // One atomic read-decide-write. A get→put pair here let concurrent calls from one account all read
    // the same `aiUsed`, all pass the limit, and all write the same result — N calls charged once, with
    // us paying upstream for every one of them.
    const charge = await ent.mutate(claims.sub, (row) => {
      const res = consumeAi(row, now, cost);
      return { row: res.allowed ? res.row : undefined, result: res };
    });
    if (!charge.allowed) {
      return charge.reason === 'no_plan' ? err(ErrorCode.NoPlan, 402) : err(ErrorCode.QuotaExhausted, 429);
    }

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
      // Atomic for the same reason: a refund read outside a transaction could observe a pre-charge
      // `aiUsed` and write back a value that erases someone else's successful charge.
      await ent.mutate(claims.sub, (row) => ({ row: refundAi(row, cost) ?? undefined, result: undefined }));
      return err(ErrorCode.AiUnavailable, 503);
    }

    if (key) await cache.put(key, req.task, content);
    return c.json({ content, cached: false, ai: evaluate(charge.row, now).ai });
  });

  return app;
}
