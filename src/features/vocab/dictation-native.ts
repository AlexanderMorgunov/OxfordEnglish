import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { bounded, DictationError, dictationError } from './dictation-types';
import type { DictationCapability, DictationMode, DictationSession, DictationUpdate } from './dictation-types';

interface NativeSpeech {
  probe(options: { session: string }): Promise<Omit<DictationCapability, 'native' | 'install'>>;
  cancelProbe(options: { session: string }): Promise<void>;
  start(options: { session: string; mode: DictationMode }): Promise<{ text: string }>;
  stop(options: { session: string }): Promise<void>;
  cancel(options: { session: string }): Promise<void>;
  addListener(event: 'update', listener: (event: DictationUpdate & { session: string }) => void): Promise<PluginListenerHandle>;
}
const api = registerPlugin<NativeSpeech>('EnglishSpeech');
export async function probeNativeDictation(signal: AbortSignal): Promise<DictationCapability> {
  const session = crypto.randomUUID();
  const cancel = () => { void api.cancelProbe({ session }).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new DictationError('canceled');
    return { ...await bounded(api.probe({ session }), signal, 8000), native: true, install: false };
  } finally { cancel(); signal.removeEventListener('abort', cancel); }
}

export function startNativeDictation(mode: DictationMode, update: (value: DictationUpdate) => void, release: () => void): DictationSession {
  const session = crypto.randomUUID();
  let resolve!: (text: string) => void, reject!: (error: DictationError) => void;
  const result = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
  let settled = false, listening = false, finishing = false, listener: PluginListenerHandle | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const clean = () => { clearTimeout(timer); void listener?.remove().catch(() => {}); listener = undefined; };
  const cancelWith = (code: DictationError['code']) => {
    if (settled) return;
    settled = true; clean(); reject(new DictationError(code));
    // Only the destroy acknowledgment (or terminal start response) frees native ownership.
    void api.cancel({ session }).then(release, () => {});
  };
  const finalize = () => {
    if (finishing || settled) return;
    finishing = true; update({ phase: 'finishing' }); clearTimeout(timer);
    timer = setTimeout(() => cancelWith('timeout'), 5000);
  };
  const stop = () => {
    if (settled || finishing) return;
    if (!listening) { cancelWith('canceled'); return; }
    finalize(); void api.stop({ session }).catch(() => cancelWith('failed'));
  };
  timer = setTimeout(() => cancelWith('timeout'), 40_000);
  void (async () => {
    try {
      const handle = await api.addListener('update', event => {
        if (settled || event.session !== session) return;
        if (event.phase === 'listening') { listening = true; clearTimeout(timer); timer = setTimeout(stop, 30_000); }
        if (event.phase === 'finishing') finalize();
        update(event);
      });
      if (settled) { await handle.remove(); return; }
      listener = handle;
      const response = await api.start({ session, mode });
      release();
      if (settled) return;
      settled = true; clean();
      if (!response.text.trim()) reject(new DictationError('empty')); else resolve(response.text.trim());
    } catch (error) {
      release();
      if (!settled) { settled = true; clean(); reject(dictationError(error)); }
    }
  })();
  return { result, stop, cancel: () => cancelWith('canceled') };
}
