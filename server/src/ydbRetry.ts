import ydbSdk from 'ydb-sdk';
import { setTimeout } from 'node:timers/promises';

const { YdbError, StatusCode } = ydbSdk;

export function isAbortedTransaction(error: unknown): boolean {
  return error instanceof YdbError &&
    Reflect.get(error.constructor, 'status') === StatusCode.ABORTED;
}

/** Only ABORTED guarantees the transaction did not commit; transport failures may hide a commit. */
export async function retryAbortedTransaction<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!isAbortedTransaction(error) || attempt >= 3) throw error;
      await setTimeout(25 * 2 ** attempt + Math.floor(Math.random() * 25));
    }
  }
}
