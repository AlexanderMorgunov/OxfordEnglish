/**
 * `discardAllBookFiles` is what releases a previous account's books, and whether it REPORTS a failure
 * decides whether the caller retries. Swallowing everything — as it did at first — meant a locked or
 * quota-blocked handle silently claimed the device for the next account with the previous one's books
 * still on it, and nothing left to retry from.
 *
 * Every other test in the suite mocks this module, so without this file the discrimination below has no
 * coverage at all.
 */
import { vi, test, expect, afterEach } from 'vitest';
import { discardAllBookFiles } from './storage';

const withStorage = (removeEntry: () => Promise<void>) => {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: async () => ({ removeEntry }) },
  });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

test('a directory that was never created counts as nothing to discard', async () => {
  withStorage(() => Promise.reject(new DOMException('no entry', 'NotFoundError')));

  await expect(discardAllBookFiles()).resolves.toBeUndefined();
});

test('a real storage failure is reported, so the release can be retried', async () => {
  withStorage(() => Promise.reject(new DOMException('locked', 'NoModificationAllowedError')));

  await expect(discardAllBookFiles()).rejects.toThrow('locked');
});

test('a browser without OPFS has nothing to discard rather than something to keep failing at', async () => {
  // `navigator.storage` missing raises a TypeError, not a DOMException — read as a real failure it would
  // pin the device to the first account that ever used it, retrying something that cannot succeed.
  await expect(discardAllBookFiles()).resolves.toBeUndefined();
});

test('the happy path removes the whole books directory in one call', async () => {
  const removeEntry = vi.fn(async () => undefined);
  withStorage(removeEntry as unknown as () => Promise<void>);

  await discardAllBookFiles();

  expect(removeEntry).toHaveBeenCalledWith('books', { recursive: true });
});
