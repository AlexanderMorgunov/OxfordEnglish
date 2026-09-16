import { vi, test, expect, beforeEach } from 'vitest';

let token: string | null = 'tok';
let local: Blob | null = null;

vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true }));
vi.mock('@/features/account/store', () => ({
  useAccount: { getState: () => ({ getAccessToken: async () => token }) },
}));
vi.mock('@/features/account/api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(
      public code: string,
      public status: number
    ) {
      super(code);
    }
  },
  blobDownloadUrl: vi.fn(),
  blobDownload: vi.fn(),
  blobList: vi.fn(),
  blobUploadUrl: vi.fn(),
  blobUpload: vi.fn(),
  blobCommit: vi.fn(),
  blobDelete: vi.fn(),
}));
vi.mock('./storage', () => ({
  getBookFile: vi.fn(async () => {
    if (!local) throw new DOMException('missing', 'NotFoundError');
    return local;
  }),
  saveBookFile: vi.fn(async (_id: string, b: Blob) => {
    local = b;
  }),
}));

import * as api from '@/features/account/api';
import { ApiFailure } from '@/features/account/api';
import { saveBookFile } from './storage';
import { downloadBookFileIfMissing } from './blobSync';

const fail = (code: string, status: number) => new ApiFailure(code, status);

beforeEach(() => {
  token = 'tok';
  local = null;
  vi.mocked(api.blobDownloadUrl).mockReset().mockResolvedValue('https://storage/x');
  vi.mocked(api.blobDownload).mockReset().mockResolvedValue(new Blob(['book']));
  vi.mocked(saveBookFile).mockClear();
});

test('a file already on the device needs no network at all', async () => {
  local = new Blob(['book']);
  expect(await downloadBookFileIfMissing('b1')).toBeNull();
  expect(api.blobDownloadUrl).not.toHaveBeenCalled();
});

test('a cloud copy is fetched and stored', async () => {
  expect(await downloadBookFileIfMissing('b1')).toBeNull();
  expect(saveBookFile).toHaveBeenCalled();
});

// The incident: the book was added on another device whose file never reached the cloud. No retry here
// can ever fix it, which is why the reason has to be distinguishable from an ordinary hiccup.
test('a missing cloud copy is reported as not-uploaded, not as a generic failure', async () => {
  vi.mocked(api.blobDownloadUrl).mockRejectedValue(fail('blob_not_found', 404));
  expect(await downloadBookFileIfMissing('b1')).toBe('not-uploaded');
});

test('being offline is told apart from the file not existing', async () => {
  vi.mocked(api.blobDownloadUrl).mockRejectedValue(fail('network', 0));
  expect(await downloadBookFileIfMissing('b1')).toBe('offline');
});

// `refresh()` swallows network errors and keeps the session, so a STALE token is non-null and the
// server answers 401. "No token" does not cover this.
test('a stale token reads as signed-out even though a token was in hand', async () => {
  vi.mocked(api.blobDownloadUrl).mockRejectedValue(fail('unauthorized', 401));
  expect(await downloadBookFileIfMissing('b1')).toBe('signed-out');
});

test('no token at all is signed-out, and nothing is requested', async () => {
  token = null;
  expect(await downloadBookFileIfMissing('b1')).toBe('signed-out');
  expect(api.blobDownloadUrl).not.toHaveBeenCalled();
});

// An expired presigned link answers 403, not 404 — worth retrying, unlike not-uploaded.
test('an expired download link is retryable, not a missing file', async () => {
  vi.mocked(api.blobDownload).mockRejectedValue(fail('blob_download_failed', 403));
  expect(await downloadBookFileIfMissing('b1')).toBe('download-failed');
});

test('bytes that arrive but cannot be stored say so', async () => {
  vi.mocked(saveBookFile).mockRejectedValue(new DOMException('quota', 'QuotaExceededError'));
  expect(await downloadBookFileIfMissing('b1')).toBe('no-space');
});
