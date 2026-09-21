import { silentEngine, type SpeechEngine } from './engine';
import { webEngine } from './web';
import { isNativePlatform, nativeEngine } from './native';

export type { SpeechEngine, Voice, SpeakHandlers } from './engine';

/**
 * Which engine answers, decided per call rather than once at import.
 *
 * Freezing the choice in a module-level constant looks tidier and is wrong twice: a test stubs
 * `speechSynthesis` in `beforeEach`, which runs after this module is imported, and a native engine
 * finishes initialising after first paint. Both would be locked out by a decision made too early.
 */
export function speechEngine(): SpeechEngine {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) return webEngine;
  // Only after the web check: an iOS WKWebView has both, and the browser API is the tested path.
  if (isNativePlatform()) return nativeEngine;
  return silentEngine;
}
