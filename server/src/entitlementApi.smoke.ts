/**
 * In-process smoke of the entitlement API (`app.request()`, no network). Run: `npx tsx src/entitlementApi.smoke.ts`.
 * The case worth having: a SECOND account claiming the trial from the SAME install is refused — that is
 * the "delete account, register again" path the install marker exists to catch.
 */
import { createApp } from './app.js';
import { InMemoryEntitlementStore, TRIAL_AI_REQUESTS, PRO_AI_REQUESTS } from './entitlements.js';
import type { Entitlement } from './contract.js';

const ent = new InMemoryEntitlementStore();
const app = createApp(undefined, undefined, undefined, ent);
const H = { 'content-type': 'application/json' };
let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: token ? { ...H, authorization: `Bearer ${token}` } : H,
    body: JSON.stringify(body),
  });

async function register(id: string): Promise<string> {
  const r = await post('/v1/auth/register', { accountId: id, verifier: `verifier-${id}-0123456789`, deviceName: 'Smoke' });
  const s = (await r.json()) as { accessToken: string };
  return s.accessToken;
}
const getEnt = async (token: string): Promise<Entitlement> => {
  const r = await app.request('/v1/entitlement', { headers: { authorization: `Bearer ${token}` } });
  return (await r.json()) as Entitlement;
};

const INSTALL = 'install-aaaaaaaaaaaaaaaa';
const tokenA = await register('acc-aaaa0123456789ab');

check('unauthenticated → 401', (await app.request('/v1/entitlement')).status === 401);

const free = await getEnt(tokenA);
check('new account → free, inactive', free.plan === 'free' && free.active === false && free.ai.limit === 0);

const claim = await post('/v1/entitlement/trial', { installId: INSTALL }, tokenA);
const trial = (await claim.json()) as Entitlement;
check('claim trial → 200 trial with the one-time budget', claim.status === 200 && trial.plan === 'trial' && trial.ai.limit === TRIAL_AI_REQUESTS);
check('trial reports an end date and no quota reset', typeof trial.trialEndsAt === 'number' && trial.ai.resetsAt === undefined);
check('GET reflects the claim', (await getEnt(tokenA)).plan === 'trial');

const again = await post('/v1/entitlement/trial', { installId: INSTALL }, tokenA);
check('re-claiming on the same account → 409', again.status === 409);

// The abuse path: drop the account, register a new one, claim from the same install.
await app.request('/v1/account', { method: 'DELETE', headers: { authorization: `Bearer ${tokenA}` } });
const tokenB = await register('acc-bbbb0123456789ab');
check('fresh account after delete → free again', (await getEnt(tokenB)).plan === 'free');
const reclaim = await post('/v1/entitlement/trial', { installId: INSTALL }, tokenB);
check('trial from the same install on a new account → 409', reclaim.status === 409);

const tokenC = await register('acc-cccc0123456789ab');
const other = await post('/v1/entitlement/trial', { installId: 'install-bbbbbbbbbbbbbbbb' }, tokenC);
check('a different install still gets its trial', other.status === 200);

// --- redeem: the grant is minted server-side at checkout, never by the client, and stays UNPAID until
//     the signature-verified payment callback confirms it ---
const draft = (invoiceId: string) => ({
  paymentRef: `robokassa:${invoiceId}`,
  invoiceId,
  days: 30,
  amountKopecks: 19900,
  boundTo: 'acc-cccc0123456789ab',
});
const grant = await ent.createGrant(draft('inv-1'));
const bad = await post('/v1/entitlement/redeem', { grantToken: 'x'.repeat(32) }, tokenC);
check('unknown grant → 400', bad.status === 400);

// The whole point of the pending state: a token handed out at checkout buys nothing until the money
// actually arrives, so a client that simply keeps its token cannot self-serve a subscription.
check('an unpaid grant → 400', (await post('/v1/entitlement/redeem', { grantToken: grant }, tokenC)).status === 400);
check('a short payment does not confirm the grant', (await ent.markGrantPaid('inv-1', 19899)) === 'underpaid');
check('the underpaid grant still will not redeem', (await post('/v1/entitlement/redeem', { grantToken: grant }, tokenC)).status === 400);
check('paying in full confirms it', (await ent.markGrantPaid('inv-1', 19900)) === 'ok');
check('a replayed callback is a no-op, not a second grant', (await ent.markGrantPaid('inv-1', 19900)) === 'ok');

// A leaked token (URL, logs, shared screen) must be worthless to anyone but the buyer.
const tokenD = await register('acc-dddd0123456789ab');
check('grant bound to another account → 400', (await post('/v1/entitlement/redeem', { grantToken: grant }, tokenD)).status === 400);
check('a refused bound redeem does NOT burn the grant', (await ent.redeemGrant(grant, 'acc-cccc0123456789ab')) === 30);

const grant2 = await ent.createGrant(draft('inv-2'));
await ent.markGrantPaid('inv-2', 19900);
const ok = await post('/v1/entitlement/redeem', { grantToken: grant2 }, tokenC);
const pro = (await ok.json()) as Entitlement;
check('redeem → pro with the monthly quota', ok.status === 200 && pro.plan === 'pro' && pro.ai.limit === PRO_AI_REQUESTS);
check('pro reports a quota reset date', typeof pro.ai.resetsAt === 'number');
check('grant is one-time', (await post('/v1/entitlement/redeem', { grantToken: grant2 }, tokenC)).status === 400);

console.log(failures === 0 ? '\nentitlement API: all checks passed' : `\nentitlement API: ${failures} FAILED`);
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = failures === 0 ? 0 : 1;
