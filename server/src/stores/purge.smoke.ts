/** Live smoke for delete-account purge (YdbAuth.deleteAccount + YdbSync.purge) against dayenglish-db. */
import { randomBytes } from 'node:crypto';
import { YdbAuthStore } from './ydbAuth.js';
import { YdbSyncStore } from './ydbSync.js';
import { driver } from '../ydb.js';
import type { Change } from '../sync.js';

let fail = 0;
const check = (n: string, c: boolean) => {
  console.log(`${c ? '✓' : '✗'} ${n}`);
  if (!c) fail += 1;
};

const auth = new YdbAuthStore();
const sync = new YdbSyncStore();
const acc = 'acc-purge-' + randomBytes(6).toString('hex');

await auth.createAccount(acc, 'hash');
const dev = 'd-' + randomBytes(3).toString('hex');
await auth.touchDevice(acc, dev, 'X');
await auth.issueRefresh(acc, dev);
const change: Change = { store: 'books', id: 'b1', updatedAt: 1, updatedBy: 'x', payload: { t: 1 } };
await sync.push(acc, 0, [change], 'purge-batch-1');

check('before purge: account + device + sync exist', (await auth.getAccount(acc)) !== null && (await auth.listDevices(acc)).length === 1 && (await sync.pull(acc, 0)).entries.length === 1);

await sync.purge(acc);
await auth.deleteAccount(acc);

check('after purge: account gone', (await auth.getAccount(acc)) === null);
check('after purge: devices gone', (await auth.listDevices(acc)).length === 0);
check('after purge: sync empty', (await sync.pull(acc, 0)).entries.length === 0 && (await sync.pull(acc, 0)).head === 0);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
process.exit(fail ? 1 : 0);
