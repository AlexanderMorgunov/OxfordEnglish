import { beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

test('queues only after study, survives tab reload and retains a pending event while there is no UI subscriber', async () => {
  let memory = await import('./memory');
  expect(memory.androidInstallPending()).toBe(false);
  memory.queueAndroidInstall();
  expect(memory.androidInstallPending()).toBe(true);
  vi.resetModules();
  memory = await import('./memory');
  expect(memory.androidInstallPending()).toBe(true);
});

test.each(['dismissed', 'store'] as const)(
  '%s persists suppression even after another study session and reload',
  async (reason) => {
    let memory = await import('./memory');
    memory.queueAndroidInstall();
    expect(memory.hideAndroidInstall(reason)).toBe(true);
    memory.queueAndroidInstall();
    expect(memory.androidInstallPending()).toBe(false);
    vi.resetModules();
    memory = await import('./memory');
    memory.queueAndroidInstall();
    expect(memory.androidInstallPending()).toBe(false);
  }
);

test('storage denial retains the event and refusal in memory without claiming persistence', async () => {
  const memory = await import('./memory');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  memory.queueAndroidInstall();
  expect(memory.androidInstallPending()).toBe(true);
  expect(memory.hideAndroidInstall('dismissed')).toBe(false);
  memory.queueAndroidInstall();
  expect(memory.androidInstallPending()).toBe(false);
});

test('account handover clears pending completion even while Today is unmounted but keeps device refusal', async () => {
  const memory = await import('./memory');
  const scope = await import('@/features/account/dataScope');
  memory.queueAndroidInstall();
  scope.invalidateDataScope();
  expect(memory.androidInstallPending()).toBe(false);
  vi.resetModules();
  expect((await import('./memory')).androidInstallPending()).toBe(false);
  memory.hideAndroidInstall('dismissed');
  scope.invalidateDataScope();
  memory.queueAndroidInstall();
  expect(memory.androidInstallPending()).toBe(false);
});

test('anonymous signup preserves the completed study after account persistence', async () => {
  const memory = await import('./memory');
  const scope = await import('@/features/account/dataScope');
  sessionStorage.setItem('dayenglish.android-install.v1.pending', 'local');
  scope.invalidateDataScope('adopt-anonymous');
  localStorage.setItem(
    'oxford-account',
    JSON.stringify({ accountId: 'new-account' })
  );
  await Promise.resolve();
  expect(memory.androidInstallPending()).toBe(true);
  vi.resetModules();
  expect((await import('./memory')).androidInstallPending()).toBe(true);
});
