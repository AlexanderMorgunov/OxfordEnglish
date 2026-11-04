import assert from 'node:assert/strict';
import ydbSdk from 'ydb-sdk';
import { isAbortedTransaction, retryAbortedTransaction } from './ydbRetry.js';

function failure(status: number): unknown {
  try {
    ydbSdk.YdbError.checkStatus({ status, issues: [] });
  } catch (error) {
    return error;
  }
  throw new Error('Expected an SDK error');
}

let attempts = 0;
const value = await retryAbortedTransaction(async () => {
  if (++attempts === 1) throw failure(ydbSdk.StatusCode.ABORTED);
  return 'committed';
});
assert.equal(value, 'committed');
assert.equal(attempts, 2);
console.log('PASS a known aborted transaction is replayed');

attempts = 0;
await assert.rejects(retryAbortedTransaction(async () => {
  attempts++;
  throw failure(ydbSdk.StatusCode.ABORTED);
}), isAbortedTransaction);
assert.equal(attempts, 4);
console.log('PASS repeated conflicts stop at the bounded attempt limit');

for (const error of [new Error('Synthetic callback failure'), failure(ydbSdk.StatusCode.UNAVAILABLE)]) {
  attempts = 0;
  await assert.rejects(retryAbortedTransaction(async () => {
    attempts++;
    throw error;
  }), actual => actual === error);
  assert.equal(attempts, 1);
}
console.log('PASS ambiguous transport and application failures are not replayed');
