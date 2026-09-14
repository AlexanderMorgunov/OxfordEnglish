/**
 * Billing (`/v1/billing/*`) — Robokassa checkout and its payment callback.
 *
 * The shape of the flow is forced by the PII firewall (docs/backend-v1-design.md §Privacy). The grants
 * table stores only a HASH of the buying account, so the callback cannot resolve a payment back to an
 * account and apply the plan itself — by design. Instead:
 *
 *   1. `POST /checkout` mints an UNPAID grant bound to the caller and hands back both the payment link
 *      and the grant token. The client keeps the token.
 *   2. Robokassa charges the card and calls `POST /robokassa/result` server-to-server. That call is
 *      signature-verified with Пароль#2 and only flips the grant to paid.
 *   3. The client redeems the token through the existing `/v1/entitlement/redeem`.
 *
 * Nothing is granted on the strength of the browser coming back to SuccessURL: that redirect is signed
 * with Пароль#1, which the payer's own address bar has already seen.
 */
import { Hono, type Context } from 'hono';
import {
  ErrorCode,
  CheckoutRequestSchema,
  IP_BUCKET_CAPACITY,
  IP_BUCKET_REFILL_PER_SEC,
} from '../contract.js';
import { bearerClaims } from '../tokens.js';
import type { EntitlementStore } from '../entitlements.js';
import {
  PLANS,
  isPlanCode,
  billingConfig,
  billingConfigured,
  checkoutUrl,
  formatSum,
  newInvoiceId,
  parseSum,
  resultAck,
  verifyResultSignature,
} from '../billing.js';
import { ipBucketLimiter } from '../rateLimit.js';

const err = (code: string, status: 400 | 401 | 503) => Response.json({ error: { code } }, { status });

/** Money that did not land where it should is the one thing here worth waking someone for, so it goes
 *  to stderr rather than into a silent return value. */
// eslint-disable-next-line no-console
const logError = (msg: string) => console.error(`[billing] ${msg}`);

/** Robokassa's method (GET or POST form) is a merchant-panel setting, so accept either and read the
 *  fields from wherever they arrived. */
async function callbackFields(c: Context): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...c.req.query() };
  if (c.req.method === 'POST') {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function billingRoutes(ent: EntitlementStore): Hono {
  const app = new Hono();
  const checkoutLimiter = ipBucketLimiter(IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_SEC);

  /** Public: the paywall has to show a price before anyone signs in, and the price is the server's to
   *  state — nothing downstream reads a hardcoded amount. */
  app.get('/v1/billing/plans', (c) =>
    c.json({
      available: billingConfigured(),
      plans: Object.values(PLANS).map((p) => ({ code: p.code, days: p.days, priceKopecks: p.priceKopecks, title: p.title })),
    })
  );

  app.post('/v1/billing/checkout', checkoutLimiter, async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const cfg = billingConfig();
    if (!cfg) return err(ErrorCode.BillingUnavailable, 503);
    const body = CheckoutRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success || !isPlanCode(body.data.plan)) return err(ErrorCode.BadRequest, 400);

    const plan = PLANS[body.data.plan];
    const invoiceId = newInvoiceId();
    const outSum = formatSum(plan.priceKopecks);
    // Written BEFORE the link exists: a payment we cannot recognise is far worse than an abandoned row.
    const grantToken = await ent.createGrant({
      paymentRef: `robokassa:${invoiceId}`,
      invoiceId,
      days: plan.days,
      amountKopecks: plan.priceKopecks,
      boundTo: claims.sub,
    });

    const paymentUrl = checkoutUrl({
      merchantLogin: cfg.merchantLogin,
      password1: cfg.password1,
      algo: cfg.algo,
      outSum,
      invoiceId,
      description: plan.title,
      // Flagged as the parent of a recurring chain here or never, but opt-in: an unapproved shop's
      // reaction to the flag is unknown, and the monthly charge job that would use it is a separate
      // slice. See `BillingConfig.recurring`.
      recurring: cfg.recurring,
      isTest: cfg.isTest,
    });

    return c.json({ paymentUrl, grantToken, invoiceId, plan: plan.code, amountKopecks: plan.priceKopecks });
  });

  /**
   * "I paid and I have nothing." Returns the token of a grant this account has already paid for and not
   * redeemed, so a buyer whose device lost it — cleared storage, bought on the phone, opened the laptop
   * — can reach what they bought without a support ticket.
   *
   * No new authority: the lookup is by the same `bindHash(accountId)` that `redeemGrant` already checks,
   * and the caller is authenticated as that account. A free account with no purchase simply gets null.
   */
  app.get('/v1/billing/unclaimed', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    return c.json({ grantToken: await ent.findUnclaimedGrant(claims.sub) });
  });

  /**
   * Robokassa's server-to-server notification. NO rate limiter: their own retries would collect 429s and
   * a payment would go unconfirmed because we throttled the acquirer.
   *
   * The reply body is load-bearing. Robokassa retries until it reads back `OK<InvId>` as plain text, so
   * every answer here is a deliberate choice about whether the notification is settled or should come
   * back. An unknown invoice or a short payment is NOT acknowledged on purpose: those are unresolved,
   * and a notification stuck in their retry queue is how a human finds out.
   */
  const handleResult = async (c: Context) => {
    const cfg = billingConfig();
    if (!cfg) return c.text('billing unavailable', 503);
    const f = await callbackFields(c);
    const outSum = f.OutSum ?? f.outSum ?? '';
    const invId = f.InvId ?? f.invId ?? '';
    const signature = f.SignatureValue ?? f.signatureValue ?? '';
    if (!outSum || !invId || !signature) return c.text('bad request', 400);

    if (!verifyResultSignature(outSum, invId, signature, cfg.password2, cfg.algo)) {
      // Never log the signature or the sum against an unverified caller — this endpoint is public and
      // an attacker would otherwise get to write our logs.
      logError('result signature mismatch');
      return c.text('bad signature', 403);
    }

    const paid = parseSum(outSum);
    if (paid == null) return c.text('bad sum', 400);

    const res = await ent.markGrantPaid(invId, paid);
    if (res === 'unknown') {
      logError(`paid invoice ${invId} matches no grant`);
      return c.text('unknown invoice', 404);
    }
    if (res === 'underpaid') {
      logError(`invoice ${invId} paid ${paid} kopecks, below the priced amount`);
      return c.text('amount mismatch', 409);
    }
    return c.text(resultAck(invId));
  };

  app.post('/v1/billing/robokassa/result', handleResult);
  app.get('/v1/billing/robokassa/result', handleResult);

  return app;
}
