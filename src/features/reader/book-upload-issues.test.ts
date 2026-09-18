/**
 * Recording WHY a book file is not in the cloud, on the device that tried. The outcome of
 * `uploadBookFile` used to be discarded at both call sites, so a device could fail every upload forever
 * and say nothing.
 *
 * The rules under test are as much about what is NOT recorded as what is: a marker on every book of every
 * free or signed-out user is noise, and noise is what gets ignored.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiFailure } from '@/features/account/api';
import type * as ApiModule from '@/features/account/api';

vi.mock('@/features/account/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('@/features/account/api');
  return {
    ...actual,
    blobUploadUrl: vi.fn(),
    blobUpload: vi.fn(),
    blobCommit: vi.fn(),
    blobList: vi.fn(),
  };
});

vi.mock('./storage', () => ({
  getBookFile: vi.fn(),
  saveBookFile: vi.fn(),
}));

vi.mock('@/features/sync/local', () => ({ stampSetting: vi.fn() }));
vi.mock('@/features/sync/settingsBridge', () => ({ registerSettingBridge: vi.fn() }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true }));

const books: { id: string; deletedAt?: number; updatedAt?: number }[] = [];
vi.mock('@/db/db', () => ({ db: { books: { toArray: async () => books } } }));

const accountState = { status: 'authenticated' as 'authenticated' | 'anonymous', getAccessToken: async (): Promise<string | null> => 'tok' };
vi.mock('@/features/account/store', () => ({ useAccount: { getState: () => accountState } }));

const api = await import('@/features/account/api');
const storage = await import('./storage');
const { uploadBookFile, syncAllBookFiles, useBookFileSync, useBookUploadIssues } = await import('./blobSync');

const file = (size: number) => ({ size }) as File;
const issues = () => useBookUploadIssues.getState().issues;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('oxford-book-upload-issues');
  useBookUploadIssues.setState({ issues: {} });
  useBookFileSync.setState({ enabled: true });
  accountState.status = 'authenticated';
  accountState.getAccessToken = async () => 'tok';
  books.length = 0;
  vi.mocked(storage.getBookFile).mockResolvedValue(file(1000));
  vi.mocked(api.blobUploadUrl).mockResolvedValue({ key: 'k', url: 'u' } as Awaited<ReturnType<typeof api.blobUploadUrl>>);
  vi.mocked(api.blobUpload).mockResolvedValue(undefined);
  vi.mocked(api.blobCommit).mockResolvedValue({ bookId: 'b1', size: 1000, uploadedAt: 1 });
});

describe('what gets recorded', () => {
  test('a file over the limit is recorded as permanent', async () => {
    vi.mocked(storage.getBookFile).mockResolvedValue(file(50 * 1024 * 1024));
    expect(await uploadBookFile('b1')).toBe('too-large');
    expect(issues().b1).toBe('too-large');
  });

  test('a full account is recorded as quota, not as a generic error', async () => {
    vi.mocked(api.blobUploadUrl).mockRejectedValue(new ApiFailure('quota_exceeded', 413));
    expect(await uploadBookFile('b1')).toBe('quota');
    expect(issues().b1).toBe('quota');
  });

  test('the paywall is its own outcome, not an error we promise to retry', async () => {
    // The toggle is NOT behind the paywall — any signed-in user can switch it on, and upload-url answers
    // 402. Calling that "something went wrong, we will try again" would be the standing message for every
    // free account, and trying again is exactly what cannot help.
    vi.mocked(api.blobUploadUrl).mockRejectedValue(new ApiFailure('no_plan', 402));
    expect(await uploadBookFile('b1')).toBe('no-plan');
    expect(issues().b1).toBe('no-plan');
  });

  test('a transient failure is recorded as an error', async () => {
    vi.mocked(api.blobUpload).mockRejectedValue(new Error('network'));
    expect(await uploadBookFile('b1')).toBe('error');
    expect(issues().b1).toBe('error');
  });

  test('a token call that REJECTS is handled like one that returns null', async () => {
    accountState.getAccessToken = async () => {
      throw new Error('refresh exploded');
    };
    expect(await uploadBookFile('b1')).toBe('signed-out');
  });
});

describe('what is deliberately NOT recorded', () => {
  test('the toggle being off is a choice, not a problem', async () => {
    useBookFileSync.setState({ enabled: false });
    expect(await uploadBookFile('b1')).toBe('sync-off');
    expect(issues()).toEqual({});
  });

  test('an anonymous user is not told their books failed to upload', async () => {
    accountState.status = 'anonymous';
    accountState.getAccessToken = async () => null;
    expect(await uploadBookFile('b1')).toBe('signed-out');
    expect(issues()).toEqual({});
  });

  test('but a signed-in user whose token will not refresh IS told', async () => {
    accountState.getAccessToken = async () => null;
    expect(await uploadBookFile('b1')).toBe('signed-out');
    expect(issues().b1).toBe('signed-out');
  });

  test('a success clears whatever was there', async () => {
    useBookUploadIssues.setState({ issues: { b1: 'error' } });
    expect(await uploadBookFile('b1')).toBe('ok');
    expect(issues()).toEqual({});
  });
});

describe('the sweep', () => {
  test('a book that failed once and landed later loses its marker', async () => {
    // It takes the `remote.has` continue branch, so nothing re-uploads it and nothing would otherwise
    // clear the flag — it would sit on the book for the life of the install.
    books.push({ id: 'b1' });
    useBookUploadIssues.setState({ issues: { b1: 'error' } });
    vi.mocked(api.blobList).mockResolvedValue({ blobs: [{ bookId: 'b1' }], usedBytes: 1, limitBytes: 2 } as Awaited<ReturnType<typeof api.blobList>>);
    await syncAllBookFiles();
    expect(issues()).toEqual({});
  });

  test('markers for books this device no longer has are pruned', async () => {
    books.push({ id: 'b1' });
    useBookUploadIssues.setState({ issues: { b1: 'error', gone: 'quota' } });
    vi.mocked(api.blobList).mockResolvedValue({ blobs: [], usedBytes: 1, limitBytes: 2 } as Awaited<ReturnType<typeof api.blobList>>);
    await syncAllBookFiles();
    expect(issues().gone).toBeUndefined();
  });

  test('a full account stops the sweep instead of spending a request per book', async () => {
    books.push({ id: 'b1' }, { id: 'b2' }, { id: 'b3' });
    vi.mocked(api.blobList).mockResolvedValue({ blobs: [], usedBytes: 1, limitBytes: 2 } as Awaited<ReturnType<typeof api.blobList>>);
    vi.mocked(api.blobUploadUrl).mockRejectedValue(new ApiFailure('quota_exceeded', 413));
    await syncAllBookFiles();
    expect(vi.mocked(api.blobUploadUrl)).toHaveBeenCalledTimes(1);
  });

  test('the paywall stops the sweep too — every remaining book gets the same answer', async () => {
    books.push({ id: 'b1' }, { id: 'b2' }, { id: 'b3' });
    vi.mocked(api.blobList).mockResolvedValue({ blobs: [], usedBytes: 1, limitBytes: 2 } as Awaited<ReturnType<typeof api.blobList>>);
    vi.mocked(api.blobUploadUrl).mockRejectedValue(new ApiFailure('no_plan', 402));
    await syncAllBookFiles();
    expect(vi.mocked(api.blobUploadUrl)).toHaveBeenCalledTimes(1);
  });

  test('a tombstoned book is neither uploaded nor kept in the markers', async () => {
    books.push({ id: 'b1', deletedAt: 20, updatedAt: 10 });
    useBookUploadIssues.setState({ issues: { b1: 'error' } });
    vi.mocked(api.blobList).mockResolvedValue({ blobs: [], usedBytes: 1, limitBytes: 2 } as Awaited<ReturnType<typeof api.blobList>>);
    await syncAllBookFiles();
    expect(vi.mocked(api.blobUploadUrl)).not.toHaveBeenCalled();
    expect(issues()).toEqual({});
  });
});

test('the markers survive a reload', () => {
  useBookUploadIssues.getState().note('b1', 'too-large');
  expect(JSON.parse(localStorage.getItem('oxford-book-upload-issues') ?? '{}')).toEqual({ b1: 'too-large' });
});

describe('a device that only has the book, not the file', () => {
  test('a book synced from another device is not blamed on this one', async () => {
    // Book metadata syncs unconditionally; the bytes do not. Letting getBookFile's throw fall into the
    // API catch reported it as `error` — "we will try again automatically" on a device that can never
    // succeed. BookReaderPage already tells the truth about this case; the library used to contradict it.
    vi.mocked(storage.getBookFile).mockRejectedValue(new Error('NotFoundError'));
    expect(await uploadBookFile('fromOtherDevice')).toBe('no-file');
    expect(issues()).toEqual({});
  });

  test('losing the local file clears a marker this device recorded earlier', async () => {
    useBookUploadIssues.setState({ issues: { b1: 'too-large' } });
    vi.mocked(storage.getBookFile).mockRejectedValue(new Error('NotFoundError'));
    await uploadBookFile('b1');
    expect(issues()).toEqual({});
  });
});

test('an account-wide refusal is recorded on every book it applies to, not just the first', async () => {
  // The sweep stops asking after a 402/quota, which is right — but the books it never reached used to be
  // left bare (reading as "fine") or holding a stale `error` that promised a retry which cannot help.
  books.push({ id: 'b1' }, { id: 'b2' }, { id: 'b3' });
  useBookUploadIssues.setState({ issues: { b3: 'error' } });
  vi.mocked(api.blobList).mockResolvedValue({ blobs: [], usedBytes: 1, limitBytes: 2 } as Awaited<ReturnType<typeof api.blobList>>);
  vi.mocked(api.blobUploadUrl).mockRejectedValue(new ApiFailure('no_plan', 402));
  await syncAllBookFiles();
  expect(vi.mocked(api.blobUploadUrl)).toHaveBeenCalledTimes(1);
  expect(issues()).toEqual({ b1: 'no-plan', b2: 'no-plan', b3: 'no-plan' });
});

describe('what is in storage on the next launch', () => {
  test('markers written before a reload are read back', async () => {
    // The old assertion only checked the WRITE direction, so replacing loadIssues() with {} passed it.
    localStorage.setItem('oxford-book-upload-issues', JSON.stringify({ b7: 'quota' }));
    vi.resetModules();
    const fresh = await import('./blobSync');
    expect(fresh.useBookUploadIssues.getState().issues).toEqual({ b7: 'quota' });
  });

  test('a stored value of the wrong shape does not take the library down', async () => {
    localStorage.setItem('oxford-book-upload-issues', 'null');
    vi.resetModules();
    const fresh = await import('./blobSync');
    expect(fresh.useBookUploadIssues.getState().issues).toEqual({});
  });
});

test('a stored value that is not a plain object is normalised, not adopted', async () => {
  // `?? {}` alone would let an array through, and every later read/write assumes a plain object.
  localStorage.setItem('oxford-book-upload-issues', '[1,2]');
  vi.resetModules();
  const fresh = await import('./blobSync');
  const loaded = fresh.useBookUploadIssues.getState().issues;
  expect(Array.isArray(loaded)).toBe(false);
  expect(loaded).toEqual({});
});
