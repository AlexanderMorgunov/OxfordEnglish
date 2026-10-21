import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installWebDictation, probeWebDictation, startWebDictation } from './dictation-web';
import type { WebRecognizer } from './dictation-web';

class Recognition implements WebRecognizer {
  static instances: Recognition[] = [];
  static available = vi.fn(async () => 'available');
  static install = vi.fn(async () => true);
  processLocally = false; quality = 'command';
  lang = ''; continuous = true; interimResults = false; maxAlternatives = 5;
  onstart: WebRecognizer['onstart'] = null; onaudioend: WebRecognizer['onaudioend'] = null;
  onend: WebRecognizer['onend'] = null; onerror: WebRecognizer['onerror'] = null; onresult: WebRecognizer['onresult'] = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { Recognition.instances.push(this); }
}
const signal = () => new AbortController().signal;
beforeEach(() => {
  Recognition.instances = []; Recognition.available.mockReset().mockResolvedValue('available'); Recognition.install.mockReset().mockResolvedValue(true);
  vi.stubGlobal('SpeechRecognition', Recognition); vi.stubGlobal('isSecureContext', true); vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function start(mode: 'local' | 'system' = 'local') {
  const release = vi.fn(), update = vi.fn();
  const session = startWebDictation(mode, update, release);
  const engine = Recognition.instances.at(-1)!;
  return { ...session, engine, release, update };
}
test('capability query does not record or download; query and start use matching local language/quality', async () => {
  expect(await probeWebDictation(signal())).toMatchObject({ local: 'ready', system: true });
  expect(Recognition.available).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true, quality: 'dictation' });
  expect(Recognition.install).not.toHaveBeenCalled(); expect(Recognition.instances[0]?.start).not.toHaveBeenCalled();
  const session = start(); const failure = expect(session.result).rejects.toMatchObject({ code: 'canceled' });
  expect(session.engine).toMatchObject({ lang: 'en-US', processLocally: true, quality: 'dictation', continuous: false, interimResults: true, maxAlternatives: 1 });
  session.cancel(); session.engine.onend?.(); await failure;
});
test('cumulative results replace interim hypotheses instead of duplicating; Stop waits actual End and only final text is accepted', async () => {
  const session = start(); session.engine.onstart?.();
  session.engine.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Take care' } }, { isFinal: false, 0: { transcript: 'near the blank' } }] });
  session.engine.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Take care' } }, { isFinal: true, 0: { transcript: 'near the bank.' } }] });
  session.stop(); expect(session.engine.stop).toHaveBeenCalledOnce(); expect(session.release).not.toHaveBeenCalled();
  session.engine.onend?.(); expect(await session.result).toBe('Take care near the bank.'); expect(session.release).toHaveBeenCalledOnce();
});
test('interim-only natural end is empty, not a silently promoted final transcript', async () => {
  const session = start(); const failure = expect(session.result).rejects.toMatchObject({ code: 'empty' });
  session.engine.onresult?.({ results: [{ isFinal: false, 0: { transcript: 'Unconfirmed text' } }] });
  session.engine.onend?.(); await failure;
});
test.each(['cancel', 'starting-stop', 'timeout', 'finishing-timeout'] as const)('%s settles promptly but holds ownership until the real End; late results ignored', async action => {
  const session = start(); const failure = expect(session.result).rejects.toMatchObject({ code: action.includes('timeout') ? 'timeout' : 'canceled' });
  if (action === 'cancel') session.cancel();
  if (action === 'starting-stop') session.stop();
  if (action === 'timeout') await vi.advanceTimersByTimeAsync(40_000);
  if (action === 'finishing-timeout') { session.engine.onstart?.(); session.stop(); await vi.advanceTimersByTimeAsync(5000); }
  await failure; expect(session.engine.abort).toHaveBeenCalledOnce(); expect(session.release).not.toHaveBeenCalled();
  const count = session.update.mock.calls.length;
  session.engine.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Late private text' } }] });
  expect(session.update).toHaveBeenCalledTimes(count);
  session.engine.onend?.(); expect(session.release).toHaveBeenCalledOnce();
});
test('30 second listening ceiling asks for final result without auto restarting', async () => {
  const session = start(); session.engine.onstart?.(); await vi.advanceTimersByTimeAsync(30_000);
  expect(session.engine.stop).toHaveBeenCalledOnce(); expect(session.engine.start).toHaveBeenCalledOnce();
  session.engine.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Finished.' } }] });
  session.engine.onend?.(); expect(await session.result).toBe('Finished.');
});
test.each([['not-allowed', 'permission'], ['language-not-supported', 'language'], ['network', 'network'], ['no-speech', 'empty']])('safe %s error does not switch local to remote', async (error, code) => {
  const session = start(); const failure = expect(session.result).rejects.toMatchObject({ code });
  session.engine.onerror?.({ error: error! }); await failure; expect(session.engine.processLocally).toBe(true);
  expect(Recognition.instances).toHaveLength(1); session.engine.onend?.();
});
test('assigning a property to an old engine does not prove local processing; explicit system still works', async () => {
  class OldRecognition extends Recognition { constructor() { super(); Reflect.deleteProperty(this, 'processLocally'); } }
  vi.stubGlobal('SpeechRecognition', OldRecognition);
  expect(await probeWebDictation(signal())).toMatchObject({ local: 'unavailable', system: true });
  expect(Recognition.available).not.toHaveBeenCalled(); expect(() => start()).toThrow('unsupported');
  const session = start('system'); const failure = expect(session.result).rejects.toMatchObject({ code: 'canceled' }); session.cancel(); session.engine.onend?.(); await failure;
});
test('browser download ownership survives UI cancel, preventing duplicate downloads; no recording on successful installation', async () => {
  let finish!: (value: boolean) => void;
  Recognition.install.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController(); const work = installWebDictation(controller.signal); const failure = expect(work).rejects.toMatchObject({ code: 'canceled' });
  controller.abort(); await failure;
  await expect(installWebDictation(signal())).rejects.toMatchObject({ code: 'busy' });
  finish(true); await Promise.resolve(); await Promise.resolve();
  await installWebDictation(signal()); expect(Recognition.instances.every(value => value.start.mock.calls.length === 0)).toBe(true);
});
