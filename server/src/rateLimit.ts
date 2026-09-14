/**
 * Per-IP abuse throttles. `clientIp` resolves the caller behind the API Gateway; `ipBucketLimiter` is an
 * in-memory token-bucket middleware for higher-frequency endpoints. The persisted register cap lives in the
 * AuthStore (it must survive across serverless instances); this file holds only the in-memory line and the
 * IP extraction both share. The durable/edge layer is Smart Web Security ARL, enabled if real abuse appears.
 */
import type { Context, MiddlewareHandler } from 'hono';
import { ErrorCode } from './contract.js';

/**
 * Client IP as seen by our trusted proxy. YC API Gateway appends the real client IP as the RIGHTMOST
 * X-Forwarded-For entry, so trust the right, not the left — the left is client-settable and would let an
 * attacker mint a fresh bucket per request (a decorative limiter, worse than none). `hops` = trusted proxies
 * in front (default 1). VERIFY empirically post-deploy: curl the gateway with a spoofed XFF and log what the
 * container receives; adjust `hops` if the gateway chain differs from the assumption.
 */
export function clientIp(c: Context, hops = 1): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[Math.max(0, parts.length - hops)] ?? parts[0];
  }
  return c.req.header('x-real-ip') ?? 'unknown';
}

type Bucket = { tokens: number; updatedAt: number };
const SWEEP_AT = 5000; // prune idle (fully-refilled) buckets once the map grows past this

/** Per-IP token bucket, in-memory (per container instance). Refills continuously; a request costs one token,
 *  a request with an empty bucket gets 429 `rate_limited`. Buckets that have refilled to capacity carry no
 *  state and are swept when the map grows, so it can't leak. */
export function ipBucketLimiter(capacity: number, refillPerSec: number): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const level = (b: Bucket, now: number) => Math.min(capacity, b.tokens + ((now - b.updatedAt) / 1000) * refillPerSec);

  return async (c, next) => {
    const now = Date.now();
    if (buckets.size > SWEEP_AT) {
      for (const [k, v] of buckets) if (level(v, now) >= capacity) buckets.delete(k);
    }
    const ip = clientIp(c);
    const tokens = level(buckets.get(ip) ?? { tokens: capacity, updatedAt: now }, now);
    if (tokens < 1) {
      buckets.set(ip, { tokens, updatedAt: now });
      return Response.json({ error: { code: ErrorCode.RateLimited } }, { status: 429 });
    }
    buckets.set(ip, { tokens: tokens - 1, updatedAt: now });
    return next();
  };
}
