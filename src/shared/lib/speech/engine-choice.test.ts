/**
 * The engine is chosen per call, not once at import.
 *
 * Freezing it in a module-level constant passes a casual reading and breaks two real cases: a test
 * stubs `speechSynthesis` in `beforeEach`, which runs long after this module is imported, and a
 * native engine finishes initialising after first paint. Both would be locked out by a decision
 * taken too early, and the symptom — read-aloud silently reporting itself as unavailable — looks
 * nothing like its cause.
 */
import { vi, test, expect, afterEach } from 'vitest';
import { speechEngine } from './index';
import { canSpeak, listEnglishVoices } from '../audio';

// `engineIndex` stands in for the extra baggage a real voice object carries — the DOM one has methods
// on its prototype, the native plugin's has the array position `speak()` selects by. Neither belongs
// in what the picker renders, and a pass-through that skipped the mapping would leak it.
const VOICES = [
  { voiceURI: 'uri-us', name: 'Alpha', lang: 'en-US', localService: true, default: true, engineIndex: 7 },
  { voiceURI: 'uri-ru', name: 'Бета', lang: 'ru-RU', localService: true, default: false, engineIndex: 8 },
];

function stubSynthesis(voices: unknown[]): void {
  const fake = { getVoices: () => voices, cancel: () => undefined, speak: () => undefined };
  vi.stubGlobal('speechSynthesis', fake);
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: fake });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'speechSynthesis');
});

test('with no synthesis in the window the engine reports itself unavailable', () => {
  expect(speechEngine().available()).toBe(false);
  expect(canSpeak()).toBe(false);
});

test('synthesis appearing AFTER this module was imported is still picked up', () => {
  expect(canSpeak()).toBe(false);

  stubSynthesis(VOICES);

  // The assertion that a module-level `const engine = pick()` would fail.
  expect(canSpeak()).toBe(true);
  expect(speechEngine().available()).toBe(true);
});

test('synthesis disappearing again is noticed too', () => {
  stubSynthesis(VOICES);
  expect(canSpeak()).toBe(true);

  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'speechSynthesis');

  expect(canSpeak()).toBe(false);
});

test('only English voices reach the picker, in our own shape', () => {
  stubSynthesis(VOICES);

  const list = listEnglishVoices();

  expect(list.map((v) => v.voiceURI)).toEqual(['uri-us']);
  // Our own object, not the platform's handed straight through: the native engine returns a
  // different shape, and the picker must not care which it got — nor see anything but these five.
  expect(Object.keys(list[0]!).sort()).toEqual([
    'default',
    'lang',
    'localService',
    'name',
    'voiceURI',
  ]);
  expect('engineIndex' in list[0]!).toBe(false);
});
