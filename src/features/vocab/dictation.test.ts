import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invalidateDataScope } from '@/features/account/dataScope';
import { cancelAudioInput, claimAudioInput } from '@/shared/lib/audio-input';
import { prepareAudioInput } from '@/shared/lib/audio';
import { probeDictation, startDictation } from './dictation';
import { startWebDictation } from './dictation-web';
import { DictationError } from './dictation-types';

const platform = vi.hoisted(() => ({ name: 'web', plugin: true }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => platform.name, isPluginAvailable: () => platform.plugin }, registerPlugin: () => ({}) }));
vi.mock('@/shared/lib/audio', () => ({ prepareAudioInput: vi.fn(async () => {}) }));
vi.mock('./dictation-web', () => ({ startWebDictation: vi.fn(), probeWebDictation: vi.fn(), installWebDictation: vi.fn() }));
beforeEach(() => { platform.name = 'web'; platform.plugin = true; vi.mocked(prepareAudioInput).mockReset().mockResolvedValue(); vi.mocked(startWebDictation).mockReset(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
test.each(['cancel', 'owner', 'output', 'background', 'starting-stop', 'timeout'])('%s during delayed output-stop acknowledgment never starts the microphone', async action => {
  let acknowledge!: () => void;
  vi.mocked(prepareAudioInput).mockReturnValue(new Promise(resolve => { acknowledge = resolve; }));
  const work = startDictation('local', vi.fn()); const failure = expect(work.result).rejects.toMatchObject({ code: action === 'timeout' ? 'timeout' : 'canceled' });
  expect(startWebDictation).not.toHaveBeenCalled();
  if (action === 'cancel') work.cancel();
  if (action === 'owner') invalidateDataScope();
  if (action === 'output') cancelAudioInput();
  if (action === 'background') window.dispatchEvent(new Event('pagehide'));
  if (action === 'starting-stop') work.stop();
  if (action === 'timeout') await vi.advanceTimersByTimeAsync(8000);
  await failure; acknowledge(); await Promise.resolve(); await Promise.resolve();
  expect(startWebDictation).not.toHaveBeenCalled(); const release = claimAudioInput(vi.fn()); expect(release).not.toBeNull(); release?.();
});
test('native stop acknowledgment precedes Start and the mic lease blocks another start through Stop/Cancel until engine End', async () => {
  let acknowledge!: () => void, release!: () => void, reject!: (error: DictationError) => void;
  vi.mocked(prepareAudioInput).mockReturnValue(new Promise(resolve => { acknowledge = resolve; }));
  const cancel = vi.fn(() => reject(new DictationError('canceled'))), stop = vi.fn();
  vi.mocked(startWebDictation).mockImplementation((_mode, _update, end) => { release = end; return { result: new Promise((_resolve, fail) => { reject = fail; }), cancel, stop }; });
  const first = startDictation('local', vi.fn()); const failure = expect(first.result).rejects.toMatchObject({ code: 'canceled' });
  acknowledge(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(startWebDictation).toHaveBeenCalledOnce(); first.stop(); expect(stop).toHaveBeenCalledOnce();
  await expect(startDictation('local', vi.fn()).result).rejects.toMatchObject({ code: 'busy' });
  first.cancel(); await failure;
  await expect(startDictation('local', vi.fn()).result).rejects.toMatchObject({ code: 'busy' });
  release(); const lease = claimAudioInput(vi.fn()); expect(lease).not.toBeNull(); lease?.();
});
test('old APK has no owned speech plugin and no web fallback or permission request', async () => {
  platform.name = 'android'; platform.plugin = false;
  expect(await probeDictation(new AbortController().signal)).toMatchObject({ local: 'unavailable', system: false });
  await expect(startDictation('system', vi.fn()).result).rejects.toMatchObject({ code: 'unsupported' });
  expect(startWebDictation).not.toHaveBeenCalled();
});
