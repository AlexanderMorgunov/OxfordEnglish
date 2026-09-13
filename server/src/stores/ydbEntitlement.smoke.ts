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
const ref = 'smoke:' + randomBytes(4).toString('hex');
const g = await s.createGrant(ref, 30, ACC);
check('grant bound to another account → refused', (await s.redeemGrant(g, OTHER)) === null);
check('refused redeem did not burn the grant', (await s.redeemGrant(g, ACC)) === 30);
check('grant is one-time', (await s.redeemGrant(g, ACC)) === null);

const [rows] = await query(
  'DECLARE $g AS Utf8; SELECT payment_ref, days, created_at, redeemed FROM payment_grants WHERE grant_token=$g;',
  { $g: T.utf8(g) }
);
const r = rows[0];
check('partial UPSERT kept payment_ref', r != null && String(r.payment_ref) === ref);
check('partial UPSERT kept days + created_at', r?.days != null && r?.created_at != null);
check('redeemed flag is set', r?.redeemed === true);

const unbound = await s.createGrant(ref + ':u', 7);
check('an unbound grant redeems for anyone', (await s.redeemGrant(unbound, OTHER)) === 7);

await s.purge(ACC);
check('purge drops the entitlement', (await s.get(ACC)) === null);
check('purge leaves the trial claim (abuse marker outlives the account)', (await s.trialClaimed(h)) === true);

await query('DECLARE $h AS Utf8; DELETE FROM trial_claims WHERE install_hash=$h;', { $h: T.utf8(h) });

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
process.exit(fail ? 1 : 0);
