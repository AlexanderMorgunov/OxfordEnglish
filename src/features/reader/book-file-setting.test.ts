import { vi, test, expect, beforeEach } from 'vitest';

// vi.mock factories are hoisted above ordinary consts, and blobSync registers its bridge at IMPORT
// time — so the shared state has to be hoisted too or it is in the temporal dead zone when that runs.
const h = vi.hoisted(() => ({
  stamped: [] as { key: string; value: unknown }[],
  bridges: new Map<string, (v: unknown) => void>(),
}));

vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true }));
vi.mock('@/features/account/store', () => ({
  useAccount: { getState: () => ({ getAccessToken: async () => 'tok' }) },
}));
vi.mock('@/features/sync/local', () => ({
  stampSetting: vi.fn(async (key: string, value: unknown) => {
    h.stamped.push({ key, value });
  }),
}));
vi.mock('@/features/sync/settingsBridge', () => ({
  registerSettingBridge: (b: { key: string; applyFromSync: (v: unknown) => void }) => h.bridges.set(b.key, b.applyFromSync),
}));
vi.mock('@/features/account/api', () => ({
  ApiFailure: class extends Error {},
  blobList: vi.fn(async () => ({ blobs: [] })),
  blobUploadUrl: vi.fn(),
  blobUpload: vi.fn(),
  blobCommit: vi.fn(),
  blobDelete: vi.fn(),
  blobDownloadUrl: vi.fn(),
  blobDownload: vi.fn(),
}));
vi.mock('@/db/db', () => ({ db: { books: { toArray: async () => [] } } }));
vi.mock('./storage', () => ({ getBookFile: vi.fn(), saveBookFile: vi.fn() }));

import { useBookFileSync } from './blobSync';

const SETTING = 'bookFileSync';
const remoteSays = (v: unknown) => h.bridges.get(SETTING)?.(v);

beforeEach(() => {
  h.stamped.length = 0;
  localStorage.clear();
  useBookFileSync.setState({ enabled: false });
});

// The reported problem: the choice was made on one device and the other still showed it off, so the
// second device kept handing out book rows whose files were never uploaded.
test('choosing on one device is stamped for the account, not kept locally', () => {
  useBookFileSync.getState().setEnabled(true);
  expect(h.stamped).toEqual([{ key: SETTING, value: true }]);
  expect(localStorage.getItem('oxford-sync-book-files')).toBe('1');
});

test('turning it off is carried to the other devices too', () => {
  useBookFileSync.setState({ enabled: true });
  useBookFileSync.getState().setEnabled(false);
  expect(h.stamped).toEqual([{ key: SETTING, value: false }]);
});

test("another device's choice arrives and is applied here", () => {
  remoteSays(true);
  expect(useBookFileSync.getState().enabled).toBe(true);
  expect(localStorage.getItem('oxford-sync-book-files')).toBe('1');
});

// Re-stamping an applied value would bounce it straight back as another push, and two devices would
// trade the same setting forever.
test('applying a synced value does not push it back', () => {
  remoteSays(true);
  expect(h.stamped).toEqual([]);
});

test('a value equal to the current one changes nothing', () => {
  useBookFileSync.setState({ enabled: true });
  remoteSays(true);
  expect(h.stamped).toEqual([]);
});

test('a malformed synced value is ignored rather than trusted', () => {
  remoteSays('yes');
  expect(useBookFileSync.getState().enabled).toBe(false);
});
