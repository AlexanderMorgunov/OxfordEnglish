/**
 * Live smoke for YdbEntitlementStore against dayenglish-db. See ydbAuth.smoke.ts for the env recipe
 * (MSYS_NO_PATHCONV=1 + YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token)).
 *
 * What the in-memory smokes structurally cannot check: optional Timestamp round-tripping, Uint32
 * counters, and — the one that would quietly corrupt the audit trail — that the partial UPSERT in
 * redeemGrant updates `redeemed` WITHOUT nulling payment_ref / days / created_at.
 */
import { randomBytes } from 'node:crypto';
import { YdbEntitlementStore } from './ydbEntitlement.js';
import { driver, query, TypedValues as T } from '../ydb.js';
import { installHash, TRIAL_AI_REQUESTS } from '../entitlements.js';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail += 1;
};

const s = new YdbEntitlementStore();
const ACC = 'acc-' + randomBytes(8).toString('hex');
const OTHER = 'acc-' + randomBytes(8).toString('hex');
const NOW = Date.now();

check('missing account → null', (await s.get(ACC)) === null);

await s.put({ accountId: ACC, trialStartedAt: NOW, aiUsed: 0, windowStartedAt: NOW });
const trial = await s.get(ACC);
check('trial row round-trips; paidUntil stays null', trial?.trialStartedAt === NOW && trial?.paidUntil === undefined);
check('windowStartedAt round-trips to the same ms', trial?.windowStartedAt === NOW);

await s.put({ accountId: ACC, trialStartedAt: NOW, paidUntil: NOW + 86_400_000, aiUsed: TRIAL_AI_REQUESTS, windowStartedAt: NOW });
const paid = await s.get(ACC);
check('optional paidUntil round-trips once set', paid?.paidUntil === NOW + 86_400_000);
check('Uint32 counter round-trips', paid?.aiUsed === TRIAL_AI_REQUESTS);

const h = installHash('install-' + randomBytes(6).toString('hex'));
check('unclaimed install → false', (await s.trialClaimed(h)) === false);
await s.markTrialClaimed(h);
check('claimed install → true', (await s.trialClaimed(h)) === true);

// --- grants ---
const INV = randomBytes(7).toString('hex');
const ref = 'smoke:' + INV;
const g = await s.createGrant({ paymentRef: ref, invoiceId: INV, days: 30, amountKopecks: 19900, boundTo: ACC });
check('a freshly minted grant is unpaid and redeems for nobody', (await s.redeemGrant(g, ACC)) === null);
check('an invoice nobody issued → unknown', (await s.markGrantPaid('no-such-' + INV, 19900)) === 'unknown');
check('a short payment → underpaid', (await s.markGrantPaid(INV, 19899)) === 'underpaid');
// The index read is the part in-memory cannot check: the callback knows only the invoice number.
check('paying in full confirms the grant through by_invoice', (await s.markGrantPaid(INV, 19900)) === 'ok');
check('a replayed callback is idempotent', (await s.markGrantPaid(INV, 19900)) === 'ok');
check('grant bound to another account → refused', (await s.redeemGrant(g, OTHER)) === null);
check('refused redeem did not burn the grant', (await s.redeemGrant(g, ACC)) === 30);
check('grant is one-time', (await s.redeemGrant(g, ACC)) === null);

const [rows] = await query(
  'DECLARE $g AS Utf8; SELECT payment_ref, invoice_id, amount_kopecks, days, created_at, paid, paid_at, redeemed FROM payment_grants WHERE grant_token=$g;',
  { $g: T.utf8(g) }
);
const r = rows[0];
check('partial UPSERT kept payment_ref', r != null && String(r.payment_ref) === ref);
check('partial UPSERT kept days + created_at', r?.days != null && r?.created_at != null);
check('partial UPSERT kept invoice_id + amount', r != null && String(r.invoice_id) === INV && r.amount_kopecks != null);
check('paid flag and paid_at survived the redeem write', r?.paid === true && r?.paid_at != null);
check('redeemed flag is set', r?.redeemed === true);

// --- findUnclaimedGrant: the by_bound read and the AS_TABLE join, which in-memory cannot exercise ---
const BUYER = 'acc-' + randomBytes(8).toString('hex');
check('no purchase → nothing outstanding', (await s.findUnclaimedGrant(BUYER)) === null);
const INV2 = randomBytes(7).toString('hex');
const ref2 = 'smoke:' + INV2;
const g2 = await s.createGrant({ paymentRef: ref2, invoiceId: INV2, days: 30, amountKopecks: 19900, boundTo: BUYER });
check('an UNPAID purchase is not offered back', (await s.findUnclaimedGrant(BUYER)) === null);
await s.markGrantPaid(INV2, 19900);
check('a paid, unredeemed grant is found through by_bound', (await s.findUnclaimedGrant(BUYER)) === g2);
check('another account gets its own answer, not this one', (await s.findUnclaimedGrant(OTHER)) === null);
await s.redeemGrant(g2, BUYER);
check('once redeemed, nothing is outstanding again', (await s.findUnclaimedGrant(BUYER)) === null);

await s.purge(ACC);
check('purge drops the entitlement', (await s.get(ACC)) === null);
check('purge leaves the trial claim (abuse marker outlives the account)', (await s.trialClaimed(h)) === true);

await query('DECLARE $h AS Utf8; DELETE FROM trial_claims WHERE install_hash=$h;', { $h: T.utf8(h) });
// Grants are payment records and have no TTL, so a smoke that leaves them behind slowly fills the
// table this run's own by_bound lookup reads. These two are ours; delete them.
for (const token of [g, g2]) {
  await query('DECLARE $g AS Utf8; DELETE FROM payment_grants WHERE grant_token=$g;', { $g: T.utf8(token) });
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
process.exit(fail ? 1 : 0);
