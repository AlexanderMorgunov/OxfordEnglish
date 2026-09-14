/**
 * In-process smoke of Robokassa checkout + its payment callback. No network, no merchant account.
 * Run: `npx tsx src/billingApi.smoke.ts`.
 *
 * Signatures are the point. They are checked in two independent halves, because the two ways this
 * integration dies look identical from the outside:
 *   1. the hash plumbing — asserted against the universally published MD5 vector for "abc";
 *   2. the signature STRING — asserted against the documented order written out BY HAND here, so
 *      reordering the parts in billing.ts fails this file rather than failing silently in production.
 *
 * The live test against real Robokassa credentials stays a manual step; nothing here can stand in for it.
 */
import { createHash } from 'node:crypto';
import { createApp } from './app.js';
import { InMemoryEntitlementStore } from './entitlements.js';
import {
  PLANS,
  checkoutSignature,
  checkoutUrl,
  formatSum,
  newInvoiceId,
  parseSum,
  resultAck,
  resultSignature,
  verifyResultSignature,
} from './billing.js';
import type { Entitlement } from './contract.js';

const LOGIN = 'dayenglish-smoke';
const PASS1 = 'p1-smoke';
const PASS2 = 'p2-smoke';
process.env.ROBOKASSA_LOGIN = LOGIN;
process.env.ROBOKASSA_PASSWORD1 = PASS1;
process.env.ROBOKASSA_PASSWORD2 = PASS2;
delete process.env.ROBOKASSA_ALGO;
delete process.env.ROBOKASSA_IS_TEST;

const ent = new InMemoryEntitlementStore();
const app = createApp(undefined, undefined, undefined, ent);
let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

// --- 1. the hash plumbing ---
check('MD5 plumbing matches the published vector for "abc"', md5('abc') === '900150983cd24fb0d6963f7d28e17f72');

// --- 2. the signature strings, written out by hand from the docs ---
const params = {
  merchantLogin: LOGIN,
  password1: PASS1,
  algo: 'md5' as const,
  outSum: '199.00',
  invoiceId: '123456789012345678',
  description: 'DayEnglish Pro — 1 месяц',
  recurring: true,
  isTest: false,
};
check(
  'checkout signature is MerchantLogin:OutSum:InvId:Пароль#1',
  checkoutSignature(params) === md5(`${LOGIN}:199.00:123456789012345678:${PASS1}`)
);
check(
  'result signature is OutSum:InvId:Пароль#2',
  resultSignature('199.00', '123456789012345678', PASS2, 'md5') === md5(`199.00:123456789012345678:${PASS2}`)
);
check(
  'the two use DIFFERENT passwords (swapping them must not verify)',
  !verifyResultSignature('199.00', '123456789012345678', md5(`199.00:123456789012345678:${PASS1}`), PASS2, 'md5')
);
check('an uppercase signature (what Robokassa sends) verifies', verifyResultSignature('199.00', '1', md5(`199.00:1:${PASS2}`).toUpperCase(), PASS2, 'md5'));
check('a tampered sum does not verify', !verifyResultSignature('1.00', '1', md5(`199.00:1:${PASS2}`), PASS2, 'md5'));
check('a short signature does not throw, it just fails', verifyResultSignature('199.00', '1', 'abc', PASS2, 'md5') === false);

// --- the link itself ---
const url = new URL(checkoutUrl(params));
check('link targets Robokassa', url.origin + url.pathname === 'https://auth.robokassa.ru/Merchant/Index.aspx');
check('the parent-recurring flag is set when asked for', url.searchParams.get('Recurring') === 'true');
check('...and absent otherwise', new URL(checkoutUrl({ ...params, recurring: false })).searchParams.get('Recurring') === null);
check('IsTest is absent outside test mode', url.searchParams.get('IsTest') === null);
check('the sum on the link is the one that was signed', url.searchParams.get('OutSum') === '199.00');
check('cyrillic description survives the round-trip', url.searchParams.get('Description') === 'DayEnglish Pro — 1 месяц');
// The PII firewall, asserted rather than asserted-about: nothing account-shaped may leave in the link.
check('no account identifier anywhere in the link', !checkoutUrl({ ...params }).includes('acc-'));

// --- amounts never ride on a float ---
check('199 ₽ formats as 199.00', formatSum(19900) === '199.00');
check('"199" parses to 19900 kopecks', parseSum('199') === 19900);
check('"199.000000" parses to 19900 kopecks', parseSum('199.000000') === 19900);
check('a comma decimal still parses', parseSum('199,00') === 19900);
check('garbage does not parse to a number', parseSum('199; DROP') === null);

// --- invoice ids ---
const ids = new Set(Array.from({ length: 200 }, () => newInvoiceId()));
check('invoice ids are unique across 200 draws', ids.size === 200);
check('invoice ids are positive decimals inside Robokassa\'s 2^63 range', [...ids].every((i) => /^\d{18}$/.test(i) && BigInt(i) < 9223372036854775807n));

// --- the routes ---
const H = { 'content-type': 'application/json' };
const post = (path: string, body: unknown, token?: string) =>
  app.request(path, { method: 'POST', headers: { ...H, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

const reg = await post('/v1/auth/register', { accountId: 'acc-bill0123456789ab', verifier: 'verifier-bill-0123456789', deviceName: 'Smoke' });
const token = ((await reg.json()) as { accessToken: string }).accessToken;

const plans = (await (await app.request('/v1/billing/plans')).json()) as { available: boolean; plans: Array<{ code: string; priceKopecks: number }> };
check('plans are public and report availability', plans.available === true);
check('the monthly plan is priced server-side at 199 ₽', plans.plans.find((p) => p.code === 'pro_month')?.priceKopecks === PLANS.pro_month.priceKopecks);

check('checkout without a session → 401', (await post('/v1/billing/checkout', { plan: 'pro_month' })).status === 401);
check('an unknown plan → 400', (await post('/v1/billing/checkout', { plan: 'pro_decade' }, token)).status === 400);

// Recurring stays OFF until Robokassa approves periodic payments for the shop — an unapproved shop's
// reaction to the flag is unknown, and guessing wrong breaks EVERY purchase, not just renewals.
const noRecur = await post('/v1/billing/checkout', { plan: 'pro_month' }, token);
const noRecurUrl = ((await noRecur.json()) as { paymentUrl: string }).paymentUrl;
check('checkout does not flag recurring by default', new URL(noRecurUrl).searchParams.get('Recurring') === null);
process.env.ROBOKASSA_RECURRING = '1';
const withRecur = await post('/v1/billing/checkout', { plan: 'pro_month' }, token);
check(
  'ROBOKASSA_RECURRING=1 turns it on',
  new URL(((await withRecur.json()) as { paymentUrl: string }).paymentUrl).searchParams.get('Recurring') === 'true'
);
delete process.env.ROBOKASSA_RECURRING;

const checkout = await post('/v1/billing/checkout', { plan: 'pro_month' }, token);
const co = (await checkout.json()) as { paymentUrl: string; grantToken: string; invoiceId: string; amountKopecks: number };
check('checkout → 200 with a payment link and a grant token', checkout.status === 200 && co.paymentUrl.startsWith('https://auth.robokassa.ru/') && co.grantToken.length >= 16);
check('the link is signed for the invoice it returned', new URL(co.paymentUrl).searchParams.get('InvId') === co.invoiceId);

// The client holds the token from this moment on — and it is worth nothing yet.
check('the grant cannot be redeemed before the money lands', (await post('/v1/entitlement/redeem', { grantToken: co.grantToken }, token)).status === 400);

const callback = (fields: Record<string, string>) =>
  app.request('/v1/billing/robokassa/result', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

const sum = formatSum(co.amountKopecks);
const goodSig = resultSignature(sum, co.invoiceId, PASS2, 'md5');

const forged = await callback({ OutSum: sum, InvId: co.invoiceId, SignatureValue: 'f'.repeat(32) });
check('an unsigned callback is refused', forged.status === 403);
check('...and it did NOT confirm the grant', (await post('/v1/entitlement/redeem', { grantToken: co.grantToken }, token)).status === 400);

// A valid signature proves who sent the notification, never what was priced.
const short = await callback({ OutSum: '1.00', InvId: co.invoiceId, SignatureValue: resultSignature('1.00', co.invoiceId, PASS2, 'md5') });
check('a correctly signed UNDERPAYMENT is not acknowledged', short.status === 409);
check('...and it did NOT confirm the grant either', (await post('/v1/entitlement/redeem', { grantToken: co.grantToken }, token)).status === 400);

const stranger = await callback({ OutSum: sum, InvId: '999999999999999999', SignatureValue: resultSignature(sum, '999999999999999999', PASS2, 'md5') });
check('an invoice we never issued is left in their retry queue, not acknowledged', stranger.status === 404);

const ok = await callback({ OutSum: sum, InvId: co.invoiceId, SignatureValue: goodSig });
// Robokassa retries until it reads back exactly this, as plain text — a JSON body loops forever.
check('a valid callback answers OK<InvId> in plain text', ok.status === 200 && (await ok.text()) === resultAck(co.invoiceId));

const replay = await callback({ OutSum: sum, InvId: co.invoiceId, SignatureValue: goodSig });
check('a retried notification is acknowledged again, not granted twice', replay.status === 200 && (await replay.text()) === resultAck(co.invoiceId));

// GET is a merchant-panel setting, so it has to work too.
const viaGet = await app.request(`/v1/billing/robokassa/result?OutSum=${sum}&InvId=${co.invoiceId}&SignatureValue=${goodSig}`);
check('the callback also works over GET', viaGet.status === 200);

const redeemed = await post('/v1/entitlement/redeem', { grantToken: co.grantToken }, token);
const pro = (await redeemed.json()) as Entitlement;
check('after payment the token redeems to pro', redeemed.status === 200 && pro.plan === 'pro');
check('the plan runs for the days the SERVER priced, not the client', pro.paidUntil != null && Math.round((pro.paidUntil - Date.now()) / 86_400_000) === PLANS.pro_month.days);
check('and the token is spent', (await post('/v1/entitlement/redeem', { grantToken: co.grantToken }, token)).status === 400);

// A second buyer's token must be worthless to the first.
const reg2 = await post('/v1/auth/register', { accountId: 'acc-bil20123456789ab', verifier: 'verifier-bil2-0123456789', deviceName: 'Smoke' });
const token2 = ((await reg2.json()) as { accessToken: string }).accessToken;
const co2 = (await (await post('/v1/billing/checkout', { plan: 'pro_month' }, token2)).json()) as { invoiceId: string; grantToken: string };
await callback({ OutSum: sum, InvId: co2.invoiceId, SignatureValue: resultSignature(sum, co2.invoiceId, PASS2, 'md5') });
check('a paid grant bound to someone else → 400', (await post('/v1/entitlement/redeem', { grantToken: co2.grantToken }, token)).status === 400);
check('...and its rightful buyer can still redeem it', (await post('/v1/entitlement/redeem', { grantToken: co2.grantToken }, token2)).status === 200);

// --- the device that lost its token ---
// A grant token lives in ONE device's storage. Buying on a phone and opening a laptop must not leave a
// paying customer with no plan and no way out but a support ticket.
{
  const reg3 = await post('/v1/auth/register', { accountId: 'acc-bil30123456789ab', verifier: 'verifier-bil3-0123456789', deviceName: 'Phone' });
  const t3 = ((await reg3.json()) as { accessToken: string }).accessToken;
  const unclaimed = (path: string, tk: string) => app.request(path, { headers: { authorization: `Bearer ${tk}` } });

  check('nothing outstanding before any purchase', ((await (await unclaimed('/v1/billing/unclaimed', t3)).json()) as { grantToken: string | null }).grantToken === null);
  check('the lookup needs a session', (await app.request('/v1/billing/unclaimed')).status === 401);

  const co3 = (await (await post('/v1/billing/checkout', { plan: 'pro_month' }, t3)).json()) as { invoiceId: string; grantToken: string };
  check(
    'an UNPAID purchase is not offered back',
    ((await (await unclaimed('/v1/billing/unclaimed', t3)).json()) as { grantToken: string | null }).grantToken === null
  );

  await callback({ OutSum: sum, InvId: co3.invoiceId, SignatureValue: resultSignature(sum, co3.invoiceId, PASS2, 'md5') });
  const recovered = ((await (await unclaimed('/v1/billing/unclaimed', t3)).json()) as { grantToken: string | null }).grantToken;
  check('a paid, unredeemed purchase is recoverable by its buyer', recovered === co3.grantToken);
  // No new authority: another account asking gets its own answer, never this one.
  check(
    'another account cannot see it',
    ((await (await unclaimed('/v1/billing/unclaimed', token2)).json()) as { grantToken: string | null }).grantToken === null
  );
  await post('/v1/entitlement/redeem', { grantToken: recovered as string }, t3);
  check(
    'once redeemed there is nothing outstanding again',
    ((await (await unclaimed('/v1/billing/unclaimed', t3)).json()) as { grantToken: string | null }).grantToken === null
  );
}

// --- unconfigured: the feature reports itself absent instead of half-working ---
delete process.env.ROBOKASSA_PASSWORD2;
check('checkout without credentials → 503', (await post('/v1/billing/checkout', { plan: 'pro_month' }, token)).status === 503);
check('plans report unavailable', ((await (await app.request('/v1/billing/plans')).json()) as { available: boolean }).available === false);
process.env.ROBOKASSA_PASSWORD2 = PASS2;

console.log(failures === 0 ? '\nbilling API: all checks passed' : `\nbilling API: ${failures} FAILED`);
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = failures === 0 ? 0 : 1;
