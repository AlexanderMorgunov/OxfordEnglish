/**
 * Live smoke for YdbTotpStore against dayenglish-db. See ydbAuth.smoke.ts for the env recipe
 * (MSYS_NO_PATHCONV=1 + YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token)).
 *
 * What the in-memory smokes structurally cannot check: that `fail_window_start` accepts epoch 0 — every
 * SUCCESSFUL verification writes that value, so a column that rejects it would make failure work and
 * success 500 — that an absent `last_step` round-trips as undefined rather than 0 (0 would refuse every
 * code as a replay), and that the backup-code list survives the newline join/split intact.
 */
import { randomBytes } from 'node:crypto';
import { YdbTotpStore } from './ydbTotp.js';
import { driver } from '../ydb.js';
import { generateBackupCodes, hashBackupCode, sealSecret, openSecret, generateSecret } from '../totp.js';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail += 1;
};

const s = new YdbTotpStore();
const ACC = 'acc-' + randomBytes(8).toString('hex');
const NOW = Date.now();
const KEY = randomBytes(32);

check('missing account → null', (await s.get(ACC)) === null);

const secret = generateSecret();
const sealed = sealSecret(secret, KEY);
await s.put({ accountId: ACC, secretEnc: sealed, backupHashes: [], failCount: 0, failWindowStart: 0 });

const pending = await s.get(ACC);
check('a pending row round-trips', pending?.accountId === ACC && pending?.secretEnc === sealed);
check('the sealed seed still unseals after a DB round-trip', (() => {
  const back = openSecret(pending!.secretEnc, KEY);
  return back.length === secret.length && back.every((b, i) => b === secret[i]);
})());
// 0 here would look like "step 0 already used", which refuses every code forever.
check('an absent last_step comes back undefined, not 0', pending?.lastStep === undefined);
check('an unconfirmed row has no confirmedAt', pending?.confirmedAt === undefined);
check('epoch-0 failWindowStart survives (written on EVERY success)', pending?.failWindowStart === 0);
check('an empty backup list is empty, not [""]', pending?.backupHashes.length === 0);

const codes = generateBackupCodes();
await s.put({
  accountId: ACC,
  secretEnc: sealed,
  confirmedAt: NOW,
  lastStep: 59_000_000,
  backupHashes: codes.map(hashBackupCode),
  failCount: 3,
  failWindowStart: NOW,
});

const confirmed = await s.get(ACC);
check('confirmedAt round-trips to the same ms', confirmed?.confirmedAt === NOW);
check('lastStep round-trips as a plain number', confirmed?.lastStep === 59_000_000);
check('failCount round-trips', confirmed?.failCount === 3);
check('failWindowStart round-trips to the same ms', confirmed?.failWindowStart === NOW);
check('all ten backup hashes survive the join/split', confirmed?.backupHashes.length === 10);
check('the hashes are byte-identical', confirmed!.backupHashes.every((h, i) => h === hashBackupCode(codes[i]!)));
check('a stored hash still matches its code', confirmed!.backupHashes.includes(hashBackupCode(codes[4]!)));

// Base64 hashes contain '+' and '/' but never a newline, which is what makes the join safe.
check('no hash contains the separator', codes.every((cd) => !hashBackupCode(cd).includes('\n')));

await s.put({ ...confirmed!, backupHashes: confirmed!.backupHashes.slice(1) });
check('burning one code leaves nine', (await s.get(ACC))?.backupHashes.length === 9);

await s.remove(ACC);
check('remove drops the row', (await s.get(ACC)) === null);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = fail ? 1 : 0;
