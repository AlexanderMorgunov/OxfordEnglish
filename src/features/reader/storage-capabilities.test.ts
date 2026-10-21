import { afterEach, expect, test, vi } from 'vitest';
import { opfsAvailable, storagePersisted } from './storage';

const original = Object.getOwnPropertyDescriptor(navigator, 'storage');
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'storage', original);
  else Reflect.deleteProperty(navigator, 'storage');
});

test('a denied storage getter reports unavailable without a render throw', () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, get: () => { throw new DOMException('denied', 'SecurityError'); } });
  expect(opfsAvailable()).toBe(false);
});

test.each(['sync', 'async', 'missing', 'false', 'true'])('optional persisted probe handles %s result without rejection', async mode => {
  const persisted = mode === 'missing' ? undefined : vi.fn(() => {
    if (mode === 'sync') throw new Error('denied');
    if (mode === 'async') return Promise.reject(new Error('denied'));
    return Promise.resolve(mode === 'true');
  });
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: () => undefined, persisted } });
  expect(opfsAvailable()).toBe(true);
  await expect(storagePersisted()).resolves.toBe(mode === 'true');
});
