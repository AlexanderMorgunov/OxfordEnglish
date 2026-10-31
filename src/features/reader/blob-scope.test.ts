import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { invalidateDataScope } from '@/features/account/dataScope';
const mocks = vi.hoisted(() => ({ download:vi.fn(), uploadUrl:vi.fn(), commit:vi.fn(), save:vi.fn(), token:vi.fn() }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true }));
vi.mock('@/features/account/store', () => ({ useAccount: {getState:()=>({getAccessToken:mocks.token,status:'authenticated'})} }));
vi.mock('@/features/account/api', () => ({ ApiFailure:class extends Error {}, blobDownloadUrl:async()=>({url:'fixture'}), blobDownload:mocks.download, blobUploadUrl:mocks.uploadUrl, blobUpload:async()=>{}, blobCommit:mocks.commit }));
vi.mock('./storage',()=>({getBookFile:vi.fn(async()=>{throw Error('missing');}),saveBookFile:mocks.save}));
const {downloadBookFileIfMissing,uploadBookFile,useBookFileSync,useBookUploadIssues}=await import('./blobSync');
beforeEach(()=>{vi.clearAllMocks();mocks.token.mockResolvedValue('fixture-token');});

test('a cloud download completed after handover does not save the previous account file',async()=>{
  mocks.download.mockImplementation(async()=>{invalidateDataScope();return new Blob(['old account file']);});
  await expect(downloadBookFileIfMissing('fixture')).resolves.toBe('signed-out');
  expect(mocks.save).not.toHaveBeenCalled();
});

test('handover while acquiring a token prevents upload and stale issue markers',async()=>{
  useBookFileSync.setState({enabled:true});useBookUploadIssues.setState({issues:{}});
  mocks.token.mockImplementation(async()=>{invalidateDataScope();return 'new-account-token';});
  await expect(uploadBookFile('fixture')).resolves.toBe('signed-out');
  expect(mocks.uploadUrl).not.toHaveBeenCalled();expect(useBookUploadIssues.getState().issues).toEqual({});
});
