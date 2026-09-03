/**
 * Live smoke for YdbAuthStore against the real dayenglish-db. Run with:
 *   YDB_ENDPOINT=... YDB_DATABASE=... YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token) npx tsx src/stores/ydbAuth.smoke.ts
 * Uses a random accountId each run so it doesn't collide; leaves rows behind (harmless test data).
 */
import { randomBytes } from 'node:crypto';
import { YdbAuthStore } from './ydbAuth.js';
import { driver } from '../ydb.js';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail += 1;
};

const s = new YdbAuthStore();
const acc = 'acc-' + randomBytes(8).toString('hex');

check('getAccount(unknown) → null', (await s.getAccount(acc)) === null);
await s.createAccount(acc, 'argon2-hash-placeholder');
check('createAccount + getAccount', (await s.getAccount(acc))?.verifierHash === 'argon2-hash-placeholder');

const dev = 'dev-' + randomBytes(4).toString('hex');
await s.touchDevice(acc, dev, 'Test Phone');
const devices = await s.listDevices(acc);
check('touchDevice + listDevices', devices.length === 1 && devices[0]!.deviceName === 'Test Phone' && devices[0]!.createdAt > 0);

const rt = await s.issueRefresh(acc, dev);
check('issueRefresh → token', !!rt && rt.length > 20);

const rot = await s.rotateRefresh(rt);
check('rotateRefresh → ok, new token', rot.status === 'ok' && rot.status === 'ok' && rot.token !== rt);
const reuse = await s.rotateRefresh(rt); // present the old (used) token again
check('reuse old token → reused', reuse.status === 'reused');
const afterReuse = await s.rotateRefresh(rot.status === 'ok' ? rot.token : ''); // family should be revoked
check('family revoked after reuse → invalid', afterReuse.status === 'invalid');

// Device linking by approval
const link = await s.createLinkRequest('New Laptop');
check('createLinkRequest → code', !!link.requestId && !!link.code);
const poll1 = await s.consumeApprovedLink(link.requestId);
check('poll before approve → pending', poll1.status === 'pending');
const bad = await s.approveLink('wrong-code', acc);
check('approve wrong code → not_found', bad.status === 'not_found');
const ok = await s.approveLink(link.code, acc);
check('approve correct code → ok + name', ok.status === 'ok' && ok.status === 'ok' && ok.deviceName === 'New Laptop');
const poll2 = await s.consumeApprovedLink(link.requestId);
check('poll after approve → approved session', poll2.status === 'approved' && poll2.status === 'approved' && poll2.accountId === acc && !!poll2.refreshToken);
const poll3 = await s.consumeApprovedLink(link.requestId);
check('poll one-time → expired', poll3.status === 'expired');

const devices2 = await s.listDevices(acc);
check('device list ≥2 after linking', devices2.length >= 2);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
process.exit(fail ? 1 : 0);
