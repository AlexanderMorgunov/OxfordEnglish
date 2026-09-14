/**
 * In-process smoke of the TOTP routes. Run: `npx tsx src/totpApi.smoke.ts`.
 *
 * The cases that matter are the recovery ones: that a rebind keeps `accountId` (a new one would orphan
 * every synced row and the paid plan), that the endpoint cannot be used to discover which account ids
 * exist, that the old credential really stops working, and that guessing is throttled.
 */
import { createApp } from './app.js';
import { InMemoryAuthStore } from './store.js';
import { InMemoryTotpStore, codeForStep, stepAt, base32Decode, VERIFY_MAX_FAILURES } from './totp.js';
import type { Session } from './contract.js';

// The sealing key normally arrives from Lockbox; the routes read it per request, so setting it here is
// enough. Nothing in this file touches a network or a real database.
process.env.TOTP_ENC_KEY = Buffer.alloc(32, 7).toString('base64');

const auth = new InMemoryAuthStore();
const totp = new InMemoryTotpStore();
const app = createApp(auth, undefined, undefined, undefined, undefined, undefined, totp);

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

const H = { 'content-type': 'application/json' };
const post = (path: string, body: unknown, token?: string) =>
  app.request(path, { method: 'POST', headers: token ? { ...H, authorization: `Bearer ${token}` } : H, body: JSON.stringify(body) });
const get = (path: string, token: string) => app.request(path, { headers: { authorization: `Bearer ${token}` } });

const ACC = 'acc-totp0123456789ab';
const OLD_VERIFIER = 'verifier-old-0123456789';
const NEW_VERIFIER = 'verifier-new-9876543210';

const reg = (await (await post('/v1/auth/register', { accountId: ACC, verifier: OLD_VERIFIER, deviceName: 'Phone' })).json()) as Session;
const token = reg.accessToken;

check('enroll without a session → 401', (await post('/v1/totp/enroll', {})).status === 401);

const enroll = (await (await post('/v1/totp/enroll', {}, token)).json()) as { secret: string; uri: string };
check('enroll returns a base32 secret', /^[A-Z2-7]{32}$/.test(enroll.secret));
check('the otpauth label carries the account id (the only way back to it)', enroll.uri.includes(encodeURIComponent(ACC)));

const secret = base32Decode(enroll.secret);
const codeNow = () => codeForStep(secret, stepAt(Date.now()));
// The routes read the real clock, and a spent step stays spent for its whole 30 s life, so back-to-back
// scenarios here would collide on one code. Clearing `lastStep` stands in for waiting out the step; the
// replay guard itself is asserted directly below and exhaustively in totp.smoke.ts.
const laterStep = async (accountId: string) => {
  const r = await totp.get(accountId);
  if (r) await totp.put({ ...r, lastStep: undefined });
};

const statusBefore = (await (await get('/v1/totp/status', token)).json()) as { enrolled: boolean; available: boolean };
check('a pending enrollment does not count as enrolled', statusBefore.enrolled === false);
check('status reports the feature as available', statusBefore.available === true);

// Status must keep ANSWERING while the feature is off — it is what tells the UI to stay silent instead
// of offering an enroll button that can only 503.
const savedKey = process.env.TOTP_ENC_KEY;
delete process.env.TOTP_ENC_KEY;
const offStatus = await get('/v1/totp/status', token);
check('status still answers 200 with no sealing key', offStatus.status === 200);
check('...reporting the feature as unavailable', ((await offStatus.json()) as { available: boolean }).available === false);
check('enroll with no sealing key → 503', (await post('/v1/totp/enroll', {}, token)).status === 503);
process.env.TOTP_ENC_KEY = savedKey;

// An unconfirmed seed must not unlock anything — nobody has proved they can read it yet.
check('recovery against a pending enrollment → 401', (await post('/v1/totp/recover', { accountId: ACC, code: codeNow(), verifier: NEW_VERIFIER })).status === 401);

check('confirm with a wrong code → 401', (await post('/v1/totp/confirm', { code: '000000' }, token)).status === 401);
const confirmed = await post('/v1/totp/confirm', { code: codeNow() }, token);
const backupCodes = ((await confirmed.json()) as { backupCodes: string[] }).backupCodes;
check('confirm returns ten backup codes', confirmed.status === 200 && backupCodes.length === 10);

const statusAfter = (await (await get('/v1/totp/status', token)).json()) as { enrolled: boolean; backupCodesLeft: number };
check('status reports enrolled with ten codes left', statusAfter.enrolled && statusAfter.backupCodesLeft === 10);
check('enrolling twice → 409', (await post('/v1/totp/enroll', {}, token)).status === 409);

// --- recovery must not be an account-id oracle ---
const unknown = await post('/v1/totp/recover', { accountId: 'acc-nosuchaccount00000', code: codeNow(), verifier: NEW_VERIFIER });
const wrongCode = await post('/v1/totp/recover', { accountId: ACC, code: '000000', verifier: NEW_VERIFIER });
check('an unknown account answers exactly like a wrong code', unknown.status === wrongCode.status && unknown.status === 401);
check('...and with the same error body', JSON.stringify(await unknown.json()) === JSON.stringify(await wrongCode.json()));

// --- a code already spent on confirm cannot be replayed into a rebind ---
check('the code just used to confirm is refused for recovery', (await post('/v1/totp/recover', { accountId: ACC, code: codeNow(), verifier: NEW_VERIFIER })).status === 401);

// --- the rebind itself ---
await laterStep(ACC);
const rec = await post('/v1/totp/recover', { accountId: ACC, code: codeNow(), verifier: NEW_VERIFIER, deviceName: 'Rescued' });
const session = (await rec.json()) as Session & { usedBackupCode: boolean };
check('recovery with a live code → 200', rec.status === 200);
check('the account id is UNCHANGED (a new one would orphan synced data)', session.accountId === ACC);
check('recovery issues a working session', !!session.accessToken && !!session.refreshToken);
check('a TOTP recovery does not spend a backup code', session.usedBackupCode === false);

const loginOld = await post('/v1/auth/login', { accountId: ACC, verifier: OLD_VERIFIER });
check('the OLD recovery key no longer logs in', loginOld.status === 401);
const loginNew = await post('/v1/auth/login', { accountId: ACC, verifier: NEW_VERIFIER });
check('the NEW key logs in to the same account', loginNew.status === 200 && ((await loginNew.json()) as Session).accountId === ACC);
check('sessions from before the rebind are revoked', (await post('/v1/auth/refresh', { refreshToken: reg.refreshToken })).status === 401);

// --- backup codes are single-use ---
const viaBackup = await post('/v1/totp/recover', { accountId: ACC, code: backupCodes[0]!, verifier: NEW_VERIFIER });
const backupBody = (await viaBackup.json()) as { usedBackupCode: boolean; backupCodesLeft: number };
check('a backup code recovers the account', viaBackup.status === 200 && backupBody.usedBackupCode === true);
check('the used code is burned (nine left)', backupBody.backupCodesLeft === 9);
check('replaying the same backup code → 401', (await post('/v1/totp/recover', { accountId: ACC, code: backupCodes[0]!, verifier: NEW_VERIFIER })).status === 401);

// --- guessing is throttled per account ---
let sawRateLimit = false;
for (let i = 0; i < VERIFY_MAX_FAILURES + 2; i += 1) {
  const r = await post('/v1/totp/recover', { accountId: ACC, code: '111111', verifier: NEW_VERIFIER });
  if (r.status === 429) sawRateLimit = true;
}
check('repeated wrong codes hit a 429 lockout', sawRateLimit);
check('the lockout also blocks a CORRECT code', (await post('/v1/totp/recover', { accountId: ACC, code: codeNow(), verifier: NEW_VERIFIER })).status === 429);

// --- disable needs a code, not just a session ---
const recovered = (await (await post('/v1/auth/login', { accountId: ACC, verifier: NEW_VERIFIER })).json()) as Session;
check('disable with a wrong code is refused', [401, 429].includes((await post('/v1/totp/disable', { code: '000000' }, recovered.accessToken)).status));

// Clear the lockout the throttle test installed, so the disable path is exercised on its own merits.
const row = await totp.get(ACC);
await totp.put({ ...row!, failCount: 0, failWindowStart: 0, lastStep: undefined });
check('disable with neither code nor key → 400', (await post('/v1/totp/disable', {}, recovered.accessToken)).status === 400);
check('disable with a WRONG recovery key is refused', (await post('/v1/totp/disable', { verifier: 'verifier-wrong-00000000' }, recovered.accessToken)).status === 401);
check('disable with a live code succeeds', (await post('/v1/totp/disable', { code: codeNow() }, recovered.accessToken)).status === 200);
check('the enrollment is gone', (await totp.get(ACC)) === null);
// 401 or 429: by this point the run has also drained the per-IP bucket that sits in front of the
// per-account throttle. Either way the one thing that must never happen is a rebind.
const afterDisable = await post('/v1/totp/recover', { accountId: ACC, code: codeNow(), verifier: 'verifier-attacker-00000' });
check('recovery is dead once disabled', [401, 429].includes(afterDisable.status));
check('...and the credential was not rebound', (await post('/v1/auth/login', { accountId: ACC, verifier: NEW_VERIFIER })).status === 200);

// --- the recovery key is the second door out of a dead enrollment ---
// Phone lost AND backup codes lost, but the key survives: without this path the account would be stuck
// with an authenticator nobody can answer.
const stuck = (await (await post('/v1/auth/login', { accountId: ACC, verifier: NEW_VERIFIER })).json()) as Session;
const re = (await (await post('/v1/totp/enroll', {}, stuck.accessToken)).json()) as { secret: string };
const reSecret = base32Decode(re.secret);
await post('/v1/totp/confirm', { code: codeForStep(reSecret, stepAt(Date.now())) }, stuck.accessToken);
check('re-enrollment is possible after a disable', ((await (await get('/v1/totp/status', stuck.accessToken)).json()) as { enrolled: boolean }).enrolled);
check('the recovery key alone disables a dead enrollment', (await post('/v1/totp/disable', { verifier: NEW_VERIFIER }, stuck.accessToken)).status === 200);
check('...leaving nothing behind', (await totp.get(ACC)) === null);

// --- erasure completeness ---
const ERASE = 'acc-erase0123456789a';
const fresh = (await (await post('/v1/auth/register', { accountId: ERASE, verifier: 'verifier-erase-0123456', deviceName: 'E' })).json()) as Session;
await post('/v1/totp/enroll', {}, fresh.accessToken);
await app.request('/v1/account', { method: 'DELETE', headers: { authorization: `Bearer ${fresh.accessToken}` } });
check('deleting the account purges its sealed seed', (await totp.get(ERASE)) === null);

console.log(failures === 0 ? '\ntotp API: all checks passed' : `\ntotp API: ${failures} FAILED`);
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = failures === 0 ? 0 : 1;
