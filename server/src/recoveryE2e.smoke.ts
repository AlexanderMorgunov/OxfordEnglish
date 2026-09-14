/**
 * End-to-end recovery, real client crypto against the real server. Run: `npx tsx src/recoveryE2e.smoke.ts`.
 *
 * The two smokes on either side of this one can both pass while recovery is still broken: the server
 * suite uses hand-made verifier strings, and the client suite mocks the API. What is only testable
 * across the seam is the property the whole design exists for — that after a rebind the user can log in
 * AGAIN LATER with the credential we handed them, on a device that kept no session.
 */
import { createApp } from './app.js';
import { InMemoryAuthStore } from './store.js';
import { InMemoryTotpStore, codeForStep, stepAt, base32Decode } from './totp.js';
import {
  generateRecoveryKey,
  deriveCredentials,
  deriveVerifier,
  formatCompositeKey,
  splitCredential,
} from '../../src/features/account/keys.js';
import type { Session } from './contract.js';

process.env.TOTP_ENC_KEY = Buffer.alloc(32, 3).toString('base64');

const totp = new InMemoryTotpStore();
const app = createApp(new InMemoryAuthStore(), undefined, undefined, undefined, undefined, undefined, totp);

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

const H = { 'content-type': 'application/json' };
const post = (path: string, body: unknown, token?: string) =>
  app.request(path, { method: 'POST', headers: token ? { ...H, authorization: `Bearer ${token}` } : H, body: JSON.stringify(body) });

// --- a user creates an account exactly as the client does ---
const originalKey = generateRecoveryKey();
const creds = await deriveCredentials(originalKey);
const reg = (await (await post('/v1/auth/register', { ...creds, deviceName: 'Phone' })).json()) as Session;
check('the client-derived credentials register', !!reg.accessToken && reg.accountId === creds.accountId);

// --- and enrolls an authenticator ---
const enroll = (await (await post('/v1/totp/enroll', {}, reg.accessToken)).json()) as { secret: string; uri: string };
const secret = base32Decode(enroll.secret);
const code = (offset = 0) => codeForStep(secret, stepAt(Date.now()) + offset);
await post('/v1/totp/confirm', { code: code() }, reg.accessToken);

// The label is where the user reads their own id back — without it recovery has nothing to look up.
const labelId = decodeURIComponent(new URL(enroll.uri).pathname.split(':')[1] ?? '');
check('the authenticator label holds the real account id', labelId === creds.accountId);

// --- the key is lost; recovery mints a new one, exactly as the store does ---
const newKey = generateRecoveryKey();
const rec = (await (await post('/v1/totp/recover', {
  accountId: labelId,
  code: code(1), // a later step: the confirm above spent the current one
  verifier: await deriveVerifier(newKey),
  deviceName: 'Rescued',
})).json()) as Session;
check('recovery succeeds with the id read off the label', rec.accountId === creds.accountId);

const composite = formatCompositeKey(rec.accountId, newKey);
check('the composite splits back into the id and the key', splitCredential(composite).accountId === creds.accountId);

// --- LATER, on a device that kept nothing: the saved credential must still work ---
const relogin = await post('/v1/auth/login', { ...(await deriveCredentials(composite)), deviceName: 'Laptop' });
const reloginBody = (await relogin.json()) as Session;
check('the composite credential logs in on a fresh device', relogin.status === 200);
check('...to the SAME account, so synced data and the paid plan follow', reloginBody.accountId === creds.accountId);

// --- and the old one is genuinely dead ---
check('the original key no longer logs in', (await post('/v1/auth/login', await deriveCredentials(originalKey))).status === 401);

// The bare new key derives a DIFFERENT id — which is precisely why the credential must carry the old one.
check('the new key ALONE would land on a different, empty account', (await post('/v1/auth/login', await deriveCredentials(newKey))).status === 401);

console.log(failures === 0 ? '\nrecovery e2e: all checks passed' : `\nrecovery e2e: ${failures} FAILED`);
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = failures === 0 ? 0 : 1;
