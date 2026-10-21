import { Capacitor } from '@capacitor/core';
import { captureDataScope, subscribeDataScope } from '@/features/account/dataScope';
import { prepareAudioInput } from '@/shared/lib/audio';
import { claimAudioInput } from '@/shared/lib/audio-input';
import { bounded, DictationError, dictationError } from './dictation-types';
import type { DictationCapability, DictationMode, DictationSession, DictationUpdate } from './dictation-types';
import { installWebDictation, probeWebDictation, startWebDictation } from './dictation-web';
import { probeNativeDictation, startNativeDictation } from './dictation-native';

const native = () => Capacitor.getPlatform() === 'android';
export function probeDictation(signal: AbortSignal): Promise<DictationCapability> {
  if (!native()) return probeWebDictation(signal);
  if (!Capacitor.isPluginAvailable('EnglishSpeech')) return Promise.resolve({ local: 'unavailable', system: false, install: false, native: true });
  return probeNativeDictation(signal);
}
export const installDictation = installWebDictation;

export function startDictation(mode: DictationMode, update: (value: DictationUpdate) => void): DictationSession {
  const scope = captureDataScope();
  const controller = new AbortController();
  let inner: DictationSession | undefined, finished = false;
  let resolve!: (text: string) => void, reject!: (error: DictationError) => void;
  const result = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
  const cleanup = () => { unsubscribe(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', cancel); };
  const cancel = () => {
    if (finished) return;
    finished = true; controller.abort(); cleanup();
    if (inner) inner.cancel(); else release?.();
    reject(new DictationError('canceled'));
  };
  const hidden = () => { if (document.hidden) cancel(); };
  const unsubscribe = subscribeDataScope(cancel);
  const release = claimAudioInput(cancel);
  if (!release) { finished = true; unsubscribe(); reject(new DictationError('busy')); return { result, cancel: () => {}, stop: () => {} }; }
  document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', cancel);
  void (async () => {
    try {
      if (!scope() || document.hidden) throw new DictationError('canceled');
      await bounded(prepareAudioInput(), controller.signal, 8000);
      if (finished || !scope() || document.hidden) throw new DictationError('canceled');
      if (native() && !Capacitor.isPluginAvailable('EnglishSpeech')) throw new DictationError('unsupported');
      inner = (native() ? startNativeDictation : startWebDictation)(mode, value => { if (!finished && scope()) update(value); }, release);
      const text = await inner.result;
      if (finished) return;
      finished = true; cleanup();
      if (scope()) resolve(text); else reject(new DictationError('canceled'));
    } catch (error) {
      if (!inner) release();
      if (!finished) { finished = true; cleanup(); reject(dictationError(error)); }
    }
  })();
  return { result, cancel, stop: () => { if (inner) inner.stop(); else cancel(); } };
}
