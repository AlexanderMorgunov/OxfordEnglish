import { bounded, DictationError } from './dictation-types';
import type { DictationCapability, DictationMode, DictationSession, DictationUpdate, LocalDictation } from './dictation-types';

type SpeechResult = { isFinal: boolean; 0?: { transcript: string } };
export interface WebRecognizer {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  processLocally?: boolean; quality?: string;
  onstart: (() => void) | null;
  onaudioend: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
interface RecognizerConstructor {
  new(): WebRecognizer;
  available?(options: { langs: string[]; processLocally: boolean; quality?: string }): Promise<string>;
  install?(options: { langs: string[]; quality?: string }): Promise<boolean>;
}
function constructor(): RecognizerConstructor | undefined {
  const host = window as unknown as { SpeechRecognition?: RecognizerConstructor; webkitSpeechRecognition?: RecognizerConstructor };
  return window.isSecureContext ? host.SpeechRecognition || host.webkitSpeechRecognition : undefined;
}
const options = (recognizer: WebRecognizer) => ({ langs: ['en-US'], ...('quality' in recognizer ? { quality: 'dictation' } : {}) });

export async function probeWebDictation(signal: AbortSignal): Promise<DictationCapability> {
  const C = constructor();
  const unavailable: DictationCapability = { local: 'unavailable', system: !!C, install: false, native: false };
  if (!C) return unavailable;
  const recognizer = new C();
  if (!('processLocally' in recognizer) || !C.available) return unavailable;
  try {
    const status = await bounded(C.available({ ...options(recognizer), processLocally: true }), signal, 8000);
    const local: LocalDictation = status === 'available' ? 'ready' : ['downloadable', 'downloading'].includes(status) ? status as LocalDictation : 'unavailable';
    return { ...unavailable, local, install: typeof C.install === 'function' };
  } catch (error) { if (signal.aborted) throw error; return unavailable; }
}

let installing: Promise<boolean> | null = null;
export async function installWebDictation(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DictationError('canceled');
  const C = constructor();
  if (!C?.install) throw new DictationError('unsupported');
  const recognizer = new C();
  if (!('processLocally' in recognizer)) throw new DictationError('unsupported');
  if (installing) throw new DictationError('busy');
  const work = C.install(options(recognizer));
  installing = work;
  // Closing the panel cannot cancel a browser-owned language-model download.
  void work.finally(() => { if (installing === work) installing = null; }).catch(() => {});
  if (!await bounded(work, signal, 60_000)) throw new DictationError('language');
}

export function startWebDictation(mode: DictationMode, update: (value: DictationUpdate) => void, release: () => void): DictationSession {
  const C = constructor();
  if (!C) throw new DictationError('unsupported');
  const recognition = new C();
  if (mode === 'local' && !('processLocally' in recognition)) throw new DictationError('unsupported');
  recognition.lang = 'en-US'; recognition.continuous = false; recognition.interimResults = true; recognition.maxAlternatives = 1;
  if ('processLocally' in recognition) recognition.processLocally = mode === 'local';
  if ('quality' in recognition) recognition.quality = 'dictation';
  let resolve!: (text: string) => void, reject!: (error: DictationError) => void;
  const result = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
  let settled = false, listening = false, finishing = false, final = '';
  let timer: ReturnType<typeof setTimeout>;
  const clear = () => { clearTimeout(timer); };
  const fail = (code: DictationError['code']) => {
    if (settled) return;
    settled = true; clear(); reject(new DictationError(code));
    try { recognition.abort(); } catch { /* End owns the microphone lease after a successful start. */ }
  };
  const cancel = () => fail('canceled');
  const finalize = () => {
    if (settled || finishing) return;
    finishing = true; clear(); update({ phase: 'finishing' });
    timer = setTimeout(() => fail('timeout'), 5000);
  };
  const stop = () => {
    if (settled || finishing) return;
    if (!listening) { cancel(); return; }
    finalize();
    try { recognition.stop(); } catch { fail('failed'); }
  };
  recognition.onstart = () => {
    if (settled) return;
    listening = true; clear(); update({ phase: 'listening' }); timer = setTimeout(stop, 30_000);
  };
  recognition.onaudioend = finalize;
  recognition.onresult = event => {
    if (settled) return;
    const finals: string[] = [], preview: string[] = [];
    for (let index = 0; index < event.results.length; index++) {
      const entry = event.results[index]; const text = entry?.[0]?.transcript.trim();
      if (!text) continue;
      preview.push(text); if (entry?.isFinal) finals.push(text);
    }
    final = finals.join(' '); update({ preview: preview.join(' ') });
  };
  recognition.onerror = ({ error }) => fail(error === 'not-allowed' || error === 'service-not-allowed' ? 'permission'
    : error === 'language-not-supported' ? 'language' : error === 'no-speech' ? 'empty' : error === 'network' ? 'network' : 'failed');
  recognition.onend = () => {
    clear();
    recognition.onstart = null; recognition.onresult = null; recognition.onerror = null; recognition.onaudioend = null; recognition.onend = null;
    release();
    if (settled) return;
    settled = true;
    if (final.trim()) resolve(final.trim()); else reject(new DictationError('empty'));
  };
  timer = setTimeout(() => fail('timeout'), 40_000);
  try { recognition.start(); }
  catch {
    clear(); settled = true; release(); reject(new DictationError('failed'));
    recognition.onstart = null; recognition.onresult = null; recognition.onerror = null; recognition.onaudioend = null; recognition.onend = null;
  }
  return { result, stop, cancel };
}
