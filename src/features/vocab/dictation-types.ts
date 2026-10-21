export type DictationMode = 'local' | 'system';
export type DictationPhase = 'starting' | 'listening' | 'finishing';
export type LocalDictation = 'ready' | 'unknown' | 'downloadable' | 'downloading' | 'unavailable';
export type DictationCapability = { local: LocalDictation; system: boolean; install: boolean; native: boolean };
export type DictationUpdate = { phase?: DictationPhase; preview?: string };
export type DictationSession = { result: Promise<string>; stop: () => void; cancel: () => void };
export class DictationError extends Error {
  constructor(public code: 'unsupported' | 'permission' | 'language' | 'empty' | 'network' | 'busy' | 'failed' | 'canceled' | 'timeout') { super(code); }
}

export function dictationError(error: unknown): DictationError {
  if (error instanceof DictationError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return new DictationError(['unsupported', 'permission', 'language', 'empty', 'network', 'busy', 'canceled', 'timeout'].includes(code) ? code as DictationError['code'] : 'failed');
}

export function bounded<T>(work: Promise<T>, signal: AbortSignal, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const end = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
    const cancel = () => { end(); reject(new DictationError('canceled')); };
    const timer = setTimeout(() => { end(); reject(new DictationError('timeout')); }, ms);
    signal.addEventListener('abort', cancel, { once: true });
    work.then(value => { end(); resolve(value); }, error => { end(); reject(dictationError(error)); });
    if (signal.aborted) cancel();
  });
}
