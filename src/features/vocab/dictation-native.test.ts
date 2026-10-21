import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { startNativeDictation, probeNativeDictation } from './dictation-native';
import type { DictationUpdate } from './dictation-types';
const { api } = vi.hoisted(() => ({ api: { start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), probe: vi.fn(), cancelProbe: vi.fn(), addListener: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => api }));
let emit: (value: DictationUpdate & { session: string }) => void;
const remove = vi.fn(async () => {});
beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset()); remove.mockClear();
  api.addListener.mockImplementation(async (_name, listener) => { emit = listener; return { remove }; });
  api.cancel.mockResolvedValue(undefined); api.stop.mockResolvedValue(undefined); api.cancelProbe.mockResolvedValue(undefined); vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
const ticks = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
test('cancel during listener registration never calls Start; late handle removed and native destroy acknowledgment owns release', async () => {
  let registered!: (value: { remove: typeof remove }) => void, acknowledge!: () => void;
  api.addListener.mockReturnValue(new Promise(resolve => { registered = resolve; }));
  api.cancel.mockReturnValue(new Promise<void>(resolve => { acknowledge = resolve; }));
  const release = vi.fn(); const session = startNativeDictation('local', vi.fn(), release);
  const failure = expect(session.result).rejects.toMatchObject({ code: 'canceled' });
  session.cancel(); await failure; expect(release).not.toHaveBeenCalled();
  registered({ remove }); await ticks(); expect(remove).toHaveBeenCalledOnce(); expect(api.start).not.toHaveBeenCalled();
  acknowledge(); await ticks(); expect(release).toHaveBeenCalledOnce();
});
test('native partial events are session-bound; Stop waits terminal result; cancel clears listener and ignores old result', async () => {
  let finish!: (value: { text: string }) => void;
  api.start.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const release = vi.fn(), update = vi.fn(); const work = startNativeDictation('system', update, release); await ticks();
  const id = api.start.mock.calls[0]?.[0].session as string;
  emit({ session: 'old-session', preview: 'Other private text' }); expect(update).not.toHaveBeenCalled();
  emit({ session: id, phase: 'listening' }); emit({ session: id, preview: 'Take care' });
  work.stop(); expect(api.stop).toHaveBeenCalledWith({ session: id }); expect(release).not.toHaveBeenCalled();
  finish({ text: 'Take care.' }); await expect(work.result).resolves.toBe('Take care.'); expect(remove).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
});
test('Stop during native permission/start wait means Cancel; late start result cannot produce text', async () => {
  let finish!: (value: { text: string }) => void;
  api.start.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const update = vi.fn(), release = vi.fn(); const work = startNativeDictation('local', update, release); const failure = expect(work.result).rejects.toMatchObject({ code: 'canceled' }); await ticks();
  work.stop(); await failure; expect(api.stop).not.toHaveBeenCalled(); expect(api.cancel).toHaveBeenCalledOnce();
  emit({ session: api.start.mock.calls[0]?.[0].session, phase: 'listening' }); finish({ text: 'Late result' }); await ticks(); expect(update).not.toHaveBeenCalled();
});
test('native capability timeout/cancel asks the plugin to destroy its query recognizer', async () => {
  api.probe.mockReturnValue(new Promise(() => {})); const controller = new AbortController();
  const query = probeNativeDictation(controller.signal); const failure = expect(query).rejects.toMatchObject({ code: 'canceled' });
  controller.abort(); await failure; expect(api.cancelProbe).toHaveBeenCalledWith(api.probe.mock.calls[0]?.[0]);
});
