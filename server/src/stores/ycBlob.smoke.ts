/**
 * Live smoke for YcBlobStore against the real dayenglish-books bucket + YDB. Validates the presigned
 * PUT/GET signatures (from Node — CORS is browser-only and not exercised here), HEAD sizing, commit/usage,
 * and delete. Needs S3_* creds + the YDB env (see the command that runs it).
 */
import { randomBytes } from 'node:crypto';
import { YcBlobStore } from './ycBlob.js';
import { driver } from '../ydb.js';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail += 1;
};

const s = new YcBlobStore();
const U = 'user-' + randomBytes(6).toString('hex');
const B = 'book-' + randomBytes(6).toString('hex');
const bytes = new Uint8Array([1, 2, 3, 4, 5]);

check('usage starts at 0', (await s.usage(U)) === 0);

const target = await s.presignUpload(U, B);
check('presignUpload → absolute url + key user/book', target.url.startsWith('http') && target.key === `${U}/${B}`);

const put = await fetch(target.url, { method: 'PUT', body: bytes });
check('PUT bytes to presigned url → ok', put.ok);

const stat = await s.statObject(target.key);
check('statObject (HEAD) → size 5', stat?.size === 5);

const meta = await s.commit(U, B, 5);
check('commit → meta', meta.bookId === B && meta.size === 5);
check('list → 1 blob', (await s.list(U)).length === 1);
check('usage → 5', (await s.usage(U)) === 5);

const dl = await s.presignDownload(U, B);
const got = await fetch(dl.url);
const gotBytes = new Uint8Array(await got.arrayBuffer());
check('presigned GET → same 5 bytes', got.ok && gotBytes.length === 5 && gotBytes[0] === 1);

await s.remove(U, B);
check('after remove → usage 0', (await s.usage(U)) === 0);
check('after remove → object gone (HEAD null)', (await s.statObject(target.key)) === null);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
process.exit(fail ? 1 : 0);
