/**
 * Pure-core checks for entitlements (no I/O — `now` is injected). Run: `npx tsx src/entitlements.smoke.ts`.
 * The load-bearing case is "a trial quota never resets": a rolling window here would silently double
 * the budget that bounds trial farming.
 */
import {
  evaluate,
  grantTrial,
  applyPayment,
  consumeAi,
  planOf,
  TRIAL_MS,
  PRO_WINDOW_MS,
  TRIAL_AI_REQUESTS,
  PRO_AI_REQUESTS,
  bindHash,
  installHash,
  legacyBindHash,
  INDEX_HASH_VERSION,
  indexKeyConfigured,
  useEphemeralIndexKey,
  type EntitlementRow,
} from './entitlements.js';

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

const T0 = 1_700_000_000_000;
const ACC = 'acc-0123456789abcdef';

check('no row → free, inactive, zero quota', (() => {
  const e = evaluate(null, T0);
  return e.plan === 'free' && !e.active && e.ai.limit === 0;
})());

// --- trial ---
const trial = grantTrial(null, ACC, T0);
check('grantTrial → trial active, one-time budget, no resetsAt', (() => {
  const e = evaluate(trial, T0);
  return e.plan === 'trial' && e.active && e.ai.limit === TRIAL_AI_REQUESTS && e.ai.resetsAt === undefined;
})());
check('trial ends exactly at start + TRIAL_MS', planOf(trial, T0 + TRIAL_MS - 1) === 'trial' && planOf(trial, T0 + TRIAL_MS) === 'free');
check('grantTrial is idempotent (replay cannot extend)', grantTrial(trial, ACC, T0 + 5 * 86_400_000).trialStartedAt === T0);

const spentTrial: EntitlementRow = { ...trial, aiUsed: TRIAL_AI_REQUESTS };
check('trial quota does NOT reset after PRO_WINDOW_MS', (() => {
  // Past the rolling window but still inside a (hypothetically longer) trial: budget must stay spent.
  const longTrial: EntitlementRow = { ...spentTrial, trialStartedAt: T0, aiUsed: TRIAL_AI_REQUESTS };
  const at = T0 + PRO_WINDOW_MS + 1;
  return planOf(longTrial, at) === 'free' && evaluate({ ...longTrial, trialStartedAt: at - 1 }, at).ai.used === TRIAL_AI_REQUESTS;
})());
check('trial consume blocked at the cap', consumeAi(spentTrial, T0).allowed === false);
check('trial consume reason is quota_exceeded', (() => {
  const r = consumeAi(spentTrial, T0);
  return !r.allowed && r.reason === 'quota_exceeded';
})());
check('free consume reason is no_plan', (() => {
  const r = consumeAi(null, T0);
  return !r.allowed && r.reason === 'no_plan';
})());

// --- pro ---
const pro = applyPayment(trial, ACC, T0, 30);
check('payment overrides an active trial', planOf(pro, T0) === 'pro' && evaluate(pro, T0).ai.limit === PRO_AI_REQUESTS);
check('entering pro from trial resets the counter and window', pro.aiUsed === 0 && pro.windowStartedAt === T0);
check('pro quota window rolls over', (() => {
  const spent: EntitlementRow = { ...pro, aiUsed: PRO_AI_REQUESTS, paidUntil: T0 + 365 * 86_400_000 };
  const before = consumeAi(spent, T0 + PRO_WINDOW_MS - 1);
  const after = consumeAi(spent, T0 + PRO_WINDOW_MS);
  return before.allowed === false && after.allowed === true && after.row.aiUsed === 1;
})());

const renewed = applyPayment(pro, ACC, T0 + 10 * 86_400_000, 30);
check('renewal stacks onto the unexpired period', renewed.paidUntil === (pro.paidUntil ?? 0) + 30 * 86_400_000);
check('renewal mid-window keeps the quota window', renewed.windowStartedAt === T0);

const lapsed: EntitlementRow = { ...pro, paidUntil: T0, aiUsed: 100 };
check('re-subscribing after a lapse starts a fresh window', (() => {
  const again = applyPayment(lapsed, ACC, T0 + 86_400_000, 30);
  return again.aiUsed === 0 && again.windowStartedAt === T0 + 86_400_000;
})());

// --- lapsed: the plan is over, the dates are not ---
const afterBoth = T0 + TRIAL_MS;
const neverTrialed: EntitlementRow = { accountId: ACC, paidUntil: T0, aiUsed: 100, windowStartedAt: T0 - PRO_WINDOW_MS };

check('a lapsed subscription still reports WHEN it ran out', (() => {
  const e = evaluate(neverTrialed, afterBoth);
  return e.plan === 'free' && e.paidUntil === T0 && e.trialEndsAt === undefined;
})());
// The load-bearing half: a date is not an entitlement. Emitting `paidUntil` here must unlock nothing.
check('a lapsed subscription unlocks nothing', (() => {
  const e = evaluate(neverTrialed, afterBoth);
  return e.active === false && e.ai.limit === 0;
})());
// Trial, then paid, then lapsed — the row §3's discriminator has to tell from a plain expired trial.
check('trialed AND paid reports both dates once both are over', (() => {
  const e = evaluate(lapsed, afterBoth);
  return e.plan === 'free' && e.paidUntil === T0 && e.trialEndsAt === T0 + TRIAL_MS;
})());
check('a row with neither date reports neither', (() => {
  const e = evaluate({ accountId: ACC, aiUsed: 0, windowStartedAt: T0 }, afterBoth);
  return e.paidUntil === undefined && e.trialEndsAt === undefined;
})());

check('consume increments and reports the new state', (() => {
  const r = consumeAi(pro, T0, 3);
  return r.allowed && r.row.aiUsed === 3 && r.entitlement.ai.used === 3;
})());
check('consume cannot straddle the cap', consumeAi({ ...pro, aiUsed: PRO_AI_REQUESTS - 1 }, T0, 2).allowed === false);


// --- keyed index hashes ---
// The old plain hash hid nothing: an account id rides in every presigned object URL, and an install id
// is stamped into synced rows, so both preimages were obtainable and the two tables could be joined.
const K1 = Buffer.alloc(32, 1).toString('base64');
const K2 = Buffer.alloc(32, 2).toString('base64');
const HASH_ACC = 'acc-0123456789abcdef';

delete process.env.INDEX_HMAC_KEY;
check('no key at all is reported, not silently tolerated', indexKeyConfigured() === false);
process.env.INDEX_HMAC_KEY = Buffer.alloc(8, 9).toString('base64');
check('a too-short key is refused', indexKeyConfigured() === false);

process.env.INDEX_HMAC_KEY = K1;
const underK1 = bindHash(HASH_ACC);
check('a binding carries the version prefix', underK1.startsWith(INDEX_HASH_VERSION));
check('a binding is stable under the same key', bindHash(HASH_ACC) === underK1);
check('the keyed form differs from the legacy one the migration looks for', underK1 !== legacyBindHash(HASH_ACC));
check('domains are separated: an install marker is not a grant binding', installHash(HASH_ACC) !== underK1);

// Why the migration must read its key from Lockbox rather than have it typed by hand: a wrong key does
// not fail. It binds every grant to nobody, which reads back exactly like "this grant is not yours".
process.env.INDEX_HMAC_KEY = K2;
check('a different key yields a different binding, with nothing to notice', bindHash(HASH_ACC) !== underK1);

useEphemeralIndexKey();
check('an ephemeral key does not overwrite one already set', bindHash(HASH_ACC) !== underK1 && indexKeyConfigured());
delete process.env.INDEX_HMAC_KEY;
useEphemeralIndexKey();
check('...but does supply one when absent, so dev runs the same code path', indexKeyConfigured());

console.log(failures === 0 ? '\nentitlements: all checks passed' : `\nentitlements: ${failures} FAILED`);
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = failures === 0 ? 0 : 1;
