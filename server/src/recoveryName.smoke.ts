/**
 * Recovery by name, pure core + in-process API. Run: `npx tsx src/recoveryName.smoke.ts`.
 *
 * The properties worth holding onto are the ones that are invisible when it works: that a stranger's
 * attempt leaves NO mark on the accounts that merely share a name with their target, that a name
 * resolving to several accounts does not multiply the chance of a code opening the wrong one, and that
 * throttling a name never closes the door on recovery by account id.
 */
import { createApp } from './app.js';
import { InMemoryAuthStore } from './store.js';
import { InMemoryTotpStore, codeForStep, stepAt, base32Decode } from './totp.js';
import {
  InMemoryRecoveryNameStore,
  normalizeName,
  nameHash,
  nameAcceptable,
  nameThrottled,
  noteNameFailure,
  refundNameAttempt,
  NAME_MAX_FAILURES,
  NAME_WINDOW_MS,
  NAME_CANDIDATE_CAP,
} from './recoveryName.js';
import { useEphemeralIndexKey } from './indexHash.js';
import type { Session } from './contract.js';

process.env.TOTP_ENC_KEY = Buffer.alloc(32, 9).toString('base64');
useEphemeralIndexKey();

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

// --- pure core ---

check('case, padding and inner spacing all fold together', normalizeName('  Саша   Петров ') === normalizeName('саша петров'));
// A composed "й" and a decomposed "и"+combining-breve look identical and are typed interchangeably.
check('composed and decomposed unicode are the same name', normalizeName('Андрей') === normalizeName('Андрей'));
check('a name that is only whitespace is rejected', !nameAcceptable('   '));
check('two characters is too short', !nameAcceptable('ян'));
check('three characters is enough, after the padding comes off', nameAcceptable(' Яна '));
check('forty-one characters is too long', !nameAcceptable('я'.repeat(41)));
check('the hash carries the version prefix', nameHash('Саша').startsWith('v2:'));
check('different names hash apart', nameHash('Саша') !== nameHash('Маша'));

const T0 = 1_700_000_000_000;
check('a fresh counter is not throttled', !nameThrottled(null, T0));
// The load-bearing one: cost is per candidate, so a name with ten accounts behind it buys a tenth of the
// attempts. Attempts fall as 1/N while the chance of matching SOME candidate rises as N, which leaves the
// odds of opening the wrong account where single-account /recover already puts them.
const charged = noteNameFailure(null, 'h', T0, 5);
check('an attempt costs one unit per candidate', charged.failCount === 5);
check('a name with no accounts behind it still costs one', noteNameFailure(null, 'h', T0, 0).failCount === 1);
check('two attempts against five candidates reach the limit', nameThrottled(noteNameFailure(charged, 'h', T0, 5), T0));
check('the window expires', !nameThrottled({ nameHash: 'h', failCount: 99, failWindowStart: T0 }, T0 + NAME_WINDOW_MS));
check(
  'an attempt after the window starts a fresh count',
  noteNameFailure({ nameHash: 'h', failCount: 99, failWindowStart: T0 }, 'h', T0 + NAME_WINDOW_MS, 1).failCount === 1
);
// Only the attempt's own cost, because the counter is shared with everyone else who chose the name.
check(
  'a refund gives back exactly what the attempt cost',
  refundNameAttempt({ nameHash: 'h', failCount: 10, failWindowStart: T0 }, 'h', T0, 4).failCount === 6
);
check(
  'a refund never goes below zero',
  refundNameAttempt({ nameHash: 'h', failCount: 1, failWindowStart: T0 }, 'h', T0, 4).failCount === 0
);

// --- the cap is a write-side invariant ---
{
  const store = new InMemoryRecoveryNameStore();
  const h = nameHash('александр');
  for (let i = 0; i < NAME_CANDIDATE_CAP; i += 1) await store.setName(`filler-${i}`, h, T0);
  check(`${NAME_CANDIDATE_CAP} accounts may share a name`, (await store.candidates(h)).length === NAME_CANDIDATE_CAP);
  // Refused at write time rather than truncated at read time: truncation would leave this account
  // permanently unrecoverable with nothing anywhere to say so.
  check('one more is refused', (await store.setName('one-too-many', h, T0)) === 'crowded');
  check('...and is not findable', !(await store.candidates(h)).includes('one-too-many'));
  // Re-setting the name you already hold must not be read as a new holder.
  check('re-setting your own name at the cap still succeeds', (await store.setName('filler-0', h, T0)) === 'ok');
}

// --- in-process API ---

const auth = new InMemoryAuthStore();
const totp = new InMemoryTotpStore();
const names = new InMemoryRecoveryNameStore();
const app = createApp(auth, undefined, undefined, undefined, undefined, undefined, totp, names);

const H = { 'content-type': 'application/json' };
const post = (path: string, body: unknown, token?: string, ip = '10.0.0.1') =>
  app.request(path, {
    method: 'POST',
    headers: { ...H, 'x-forwarded-for': ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const del = (path: string, token: string) =>
  app.request(path, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
const get = (path: string, token: string) => app.request(path, { headers: { authorization: `Bearer ${token}` } });

/** Register, enrol and confirm, so the account is in the only state name recovery can succeed from. */
async function enrolled(accountId: string, verifier: string): Promise<{ session: Session; secret: Uint8Array }> {
  const session = (await (await post('/v1/auth/register', { accountId, verifier, deviceName: 'Phone' })).json()) as Session;
  const e = (await (await post('/v1/totp/enroll', {}, session.accessToken)).json()) as { secret: string };
  const secret = base32Decode(e.secret);
  await post('/v1/totp/confirm', { code: codeForStep(secret, stepAt(Date.now())) }, session.accessToken);
  return { session, secret };
}

/** A spent step stays spent for its whole 30 s life, so back-to-back scenarios would collide on one code.
 *  Clearing `lastStep` stands in for waiting; the replay guard itself is asserted directly below. */
const laterStep = async (accountId: string) => {
  const r = await totp.get(accountId);
  if (r) await totp.put({ ...r, lastStep: undefined });
};
const codeFor = (secret: Uint8Array) => codeForStep(secret, stepAt(Date.now()));

const A = await enrolled('acc-name-aaaaaaaaaaaa', 'verifier-a-0123456789');

check('setting a name without a session → 401', (await post('/v1/recovery-name', { name: 'Саша' })).status === 401);
check('a two-character name is refused', (await post('/v1/recovery-name', { name: 'ян' }, A.session.accessToken)).status === 400);
check('setting a name succeeds', (await post('/v1/recovery-name', { name: ' Саша ' }, A.session.accessToken)).status === 200);

const withName = (await (await get('/v1/totp/status', A.session.accessToken)).json()) as { recoveryName: boolean };
check('status reports that a name is set', withName.recoveryName === true);

// An unconfirmed enrolment must not open anything, and neither must a name pointing at one.
{
  const pendingSession = (await (
    await post('/v1/auth/register', { accountId: 'acc-name-pending00000', verifier: 'verifier-p-0123456789', deviceName: 'P' })
  ).json()) as Session;
  const e = (await (await post('/v1/totp/enroll', {}, pendingSession.accessToken)).json()) as { secret: string };
  await post('/v1/recovery-name', { name: 'Незавершённый' }, pendingSession.accessToken);
  const attempt = await post(
    '/v1/totp/recover-by-name',
    { name: 'Незавершённый', code: codeFor(base32Decode(e.secret)), verifier: 'verifier-x-0123456789' },
    undefined,
    '10.0.0.2'
  );
  check('a name pointing at an unfinished setup opens nothing', attempt.status === 401);
}

// The whole point: the recovery key is gone, so the account id is gone with it, and the name is all the
// user has left.
await laterStep('acc-name-aaaaaaaaaaaa');
const V_A2 = 'verifier-a2-9876543210';
const recovered = await post(
  '/v1/totp/recover-by-name',
  { name: 'саша', code: codeFor(A.secret), verifier: V_A2, deviceName: 'Laptop' },
  undefined,
  '10.0.0.3'
);
const recoveredSession = (await recovered.json()) as Session;
check('recovery by name succeeds', recovered.status === 200);
// A new id would orphan every synced row, the books in object storage and the paid plan.
check('the account id is UNCHANGED', recoveredSession.accountId === 'acc-name-aaaaaaaaaaaa');
check('the new verifier works', (await post('/v1/auth/login', { accountId: 'acc-name-aaaaaaaaaaaa', verifier: V_A2 })).status === 200);
check(
  'the old verifier is dead',
  (await post('/v1/auth/login', { accountId: 'acc-name-aaaaaaaaaaaa', verifier: 'verifier-a-0123456789' })).status === 401
);

// The code is single-use across this path too, or anyone who saw it over a shoulder has 30 seconds.
const replay = await post(
  '/v1/totp/recover-by-name',
  { name: 'саша', code: codeFor(A.secret), verifier: 'verifier-a3-1111111111' },
  undefined,
  '10.0.0.4'
);
check('replaying the same code is refused', replay.status === 401);

// --- two accounts, one name ---
const B = await enrolled('acc-name-bbbbbbbbbbbb', 'verifier-b-0123456789');
const C = await enrolled('acc-name-cccccccccccc', 'verifier-c-0123456789');
await post('/v1/recovery-name', { name: 'Иван' }, B.session.accessToken);
await post('/v1/recovery-name', { name: 'иван' }, C.session.accessToken);
check('a shared name resolves to both accounts', (await names.candidates(nameHash('иван'))).length === 2);

await laterStep('acc-name-cccccccccccc');
const pickedC = await post(
  '/v1/totp/recover-by-name',
  { name: 'ИВАН', code: codeFor(C.secret), verifier: 'verifier-c2-2222222222' },
  undefined,
  '10.0.0.5'
);
check('the authenticator picks the right account out of the two', ((await pickedC.json()) as Session).accountId === 'acc-name-cccccccccccc');

// A stranger guessing at a shared name must not cost the people behind it anything. If it did, ten
// requests with a common name would lock every holder out of their own recovery — hitting precisely the
// users who bothered to enrol.
const before = await totp.get('acc-name-bbbbbbbbbbbb');
await post('/v1/totp/recover-by-name', { name: 'иван', code: '000000', verifier: 'verifier-z-0123456789' }, undefined, '10.0.0.6');
const after = await totp.get('acc-name-bbbbbbbbbbbb');
check('a wrong code leaves the account failure counter untouched', after?.failCount === before?.failCount && after?.failCount === 0);
check('...and the unauthenticated one too', (after?.anonFailCount ?? 0) === 0);
// The cost landed on the name instead, and at two units — one per account the name resolves to.
const nameCost = await names.bumpAttempts(nameHash('иван'), (a) => ({ result: a?.failCount ?? 0 }));
check('the cost lands on the name, one unit per candidate', nameCost === 2);

// --- the throttle is on the name, and charged per candidate ---
// Two accounts behind one name and one behind another, then the same number of wrong codes at each. The
// shared name runs out and the solo one does not, which is the per-candidate charge made visible from
// outside: attempts fall as 1/N exactly as the chance of a code matching SOME candidate rises as N.
const SHARED = NAME_MAX_FAILURES / 2;
await enrolled('acc-name-hhhhhhhhhhhh', 'verifier-h-0123456789').then((h) =>
  post('/v1/recovery-name', { name: 'Тёзки' }, h.session.accessToken)
);
await enrolled('acc-name-iiiiiiiiiiii', 'verifier-i-0123456789').then((i) =>
  post('/v1/recovery-name', { name: 'тёзки' }, i.session.accessToken)
);
await enrolled('acc-name-jjjjjjjjjjjj', 'verifier-j-0123456789').then((j) =>
  post('/v1/recovery-name', { name: 'Одиночка' }, j.session.accessToken)
);

const guess = (name: string, ip: string) =>
  post('/v1/totp/recover-by-name', { name, code: '000000', verifier: 'verifier-z-0123456789' }, undefined, ip);

let lastShared = 0;
for (let i = 0; i < SHARED; i += 1) lastShared = (await guess('тёзки', '10.0.0.7')).status;
check('wrong codes keep answering 401 up to the limit', lastShared === 401);
// 429 rather than 401 here: the user has to be told to wait, and unlike an account id a name is not an
// enrolment oracle — a name nobody uses is charged too, so every name can reach this.
check('a two-account name is spent after half the attempts', (await guess('тёзки', '10.0.0.7')).status === 429);

let lastSolo = 0;
for (let i = 0; i < SHARED; i += 1) lastSolo = (await guess('одиночка', '10.0.0.10')).status;
check('the same number of attempts leaves a one-account name open', lastSolo === 401);

// Containment. Throttling a name must never take away the route that does not depend on it, or one
// stranger hammering a common name would strand everyone who shares it.
await laterStep('acc-name-bbbbbbbbbbbb');
const byId = await post(
  '/v1/totp/recover',
  { accountId: 'acc-name-bbbbbbbbbbbb', code: codeFor(B.secret), verifier: 'verifier-b2-3333333333' },
  undefined,
  '10.0.0.8'
);
check('recovery by account id still works while the name is throttled', byId.status === 200);

// A success has to give the budget back, or a legitimate user who mistyped four times would be locked
// out by their own fifth, correct attempt.
{
  const D = await enrolled('acc-name-dddddddddddd', 'verifier-d-0123456789');
  await post('/v1/recovery-name', { name: 'Дмитрий' }, D.session.accessToken);
  for (let i = 0; i < NAME_MAX_FAILURES - 1; i += 1) {
    await post('/v1/totp/recover-by-name', { name: 'дмитрий', code: '000000', verifier: 'verifier-z-0123456789' }, undefined, '10.0.0.9');
  }
  await laterStep('acc-name-dddddddddddd');
  const ok = await post(
    '/v1/totp/recover-by-name',
    { name: 'дмитрий', code: codeFor(D.secret), verifier: 'verifier-d2-4444444444' },
    undefined,
    '10.0.0.9'
  );
  check('the last attempt before the lockout still succeeds', ok.status === 200);
  const afterSuccess = await post(
    '/v1/totp/recover-by-name',
    { name: 'дмитрий', code: '000000', verifier: 'verifier-z-0123456789' },
    undefined,
    '10.0.0.9'
  );
  check('a success gives the budget back', afterSuccess.status === 401);
}

// The attack the refund would otherwise open. A name belongs to nobody, so an attacker can join their
// target's name with a throwaway account, guess until the lockout, then clear the counter by "recovering"
// their own account with a code they legitimately hold — and guess again, forever.
{
  const K = await enrolled('acc-name-kkkkkkkkkkkk', 'verifier-k-0123456789');
  await enrolled('acc-name-llllllllllll', 'verifier-l-0123456789').then((l) =>
    post('/v1/recovery-name', { name: 'Двое' }, l.session.accessToken)
  );
  await post('/v1/recovery-name', { name: 'Двое' }, K.session.accessToken);
  const H2 = nameHash('двое');
  const read = () => names.bumpAttempts(H2, (a) => ({ result: a?.failCount ?? 0 }));

  const BAD = NAME_MAX_FAILURES / 2 - 1;
  for (let i = 0; i < BAD; i += 1) await guess('двое', '10.0.0.11');
  check('four guesses against two candidates cost eight', (await read()) === 8);

  await laterStep('acc-name-kkkkkkkkkkkk');
  const won = await post(
    '/v1/totp/recover-by-name',
    { name: 'двое', code: codeFor(K.secret), verifier: 'verifier-k2-5555555555' },
    undefined,
    '10.0.0.11'
  );
  check('one of the two holders recovers', won.status === 200);
  // Back to eight, not to zero: the success paid its own two units and got those two back.
  check('a success on a shared name refunds only its own cost', (await read()) === 8);

  await guess('двое', '10.0.0.11');
  check('...so the budget is still nearly spent', (await read()) === 10);
  check('...and the next guess is refused', (await guess('двое', '10.0.0.11')).status === 429);
}

// --- one name per account ---
{
  const E = await enrolled('acc-name-eeeeeeeeeeee', 'verifier-e-0123456789');
  await post('/v1/recovery-name', { name: 'Первое' }, E.session.accessToken);
  await post('/v1/recovery-name', { name: 'Второе' }, E.session.accessToken);
  check('the new name finds the account', (await names.candidates(nameHash('второе'))).includes('acc-name-eeeeeeeeeeee'));
  // Not merely tidiness: a leftover row keeps the account findable under every name it has ever used,
  // including one the user abandoned precisely because someone else knew it.
  check('the old name no longer does', (await names.candidates(nameHash('первое'))).length === 0);

  check('a name can be removed', (await del('/v1/recovery-name', E.session.accessToken)).status === 200);
  check('...and status says so', !((await (await get('/v1/totp/status', E.session.accessToken)).json()) as { recoveryName: boolean }).recoveryName);
  check('...and it resolves to nobody', (await names.candidates(nameHash('второе'))).length === 0);
}

// --- deleting the account takes the name with it ---
{
  const F = await enrolled('acc-name-ffffffffffff', 'verifier-f-0123456789');
  await post('/v1/recovery-name', { name: 'Удаляемый' }, F.session.accessToken);
  const gone = await app.request('/v1/account', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${F.session.accessToken}` },
  });
  check('the account is deleted', gone.status === 200);
  // The row is the one place an account id sits beside something the user chose, so erasure has to
  // reach it.
  check('the name row goes with the account', (await names.candidates(nameHash('удаляемый'))).length === 0);
}

// --- the cap, through the API ---
{
  const G = await enrolled('acc-name-gggggggggggg', 'verifier-g-0123456789');
  const crowded = nameHash('толпа');
  for (let i = 0; i < NAME_CANDIDATE_CAP; i += 1) await names.setName(`crowd-${i}`, crowded, Date.now());
  const refused = await post('/v1/recovery-name', { name: 'Толпа' }, G.session.accessToken);
  check('a name already at the cap is refused with 409', refused.status === 409);
  check(
    '...naming the reason, so the UI can ask for a different one',
    ((await refused.json()) as { error: { code: string } }).error.code === 'recovery_name_crowded'
  );
}

console.log(failures === 0 ? '\nrecovery name: all checks passed' : `\nrecovery name: ${failures} FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
