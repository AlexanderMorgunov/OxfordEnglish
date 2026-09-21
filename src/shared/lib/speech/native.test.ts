/**
 * The native engine, against a mock plugin.
 *
 * Each case here is a defect the audit predicted rather than a line of coverage: the voice index is
 * the one place where a plausible-looking mistake makes a German voice read English aloud, and the
 * gap between "cancel" and "the await that was already in flight" is where speech escapes a stopped UI.
 */
import { vi, test, expect, beforeEach, afterEach } from 'vitest';

/**
 * Non-English FIRST on purpose, so a filtered index and a raw index disagree from the very first row.
 *
 * The two en-US voices differ ONLY in locality, and the network one is listed first: anything but a
 * real preference for the local voice loses the tie to array order and picks the one that costs a
 * round trip per sentence.
 */
const VOICES = [
  { voiceURI: 'de-de-x-nfh#female_1-local', name: 'German Germany', lang: 'de-DE', localService: true, default: false },
  { voiceURI: 'en-gb-x-gba#male_2-network', name: 'English United Kingdom', lang: 'en-GB', localService: false, default: false },
  { voiceURI: 'en-us-x-tpd#male_3-network', name: 'English United States', lang: 'en-US', localService: false, default: false },
  { voiceURI: 'en-us-x-sfg#female_1-local', name: 'English United States', lang: 'en-US', localService: true, default: false },
];

type SpeakCall = { text: string; voice?: number; rate?: number; lang?: string };

let spoken: SpeakCall[];
let settle: { resolve: () => void; reject: () => void } | null;
let stopped: number;
let languageSupported: boolean;
let voices: typeof VOICES;

const plugin = {
  speak: (o: SpeakCall) => {
    spoken.push(o);
    return new Promise<void>((resolve, reject) => {
      settle = { resolve, reject };
    });
  },
  stop: () => {
    stopped += 1;
    return Promise.resolve();
  },
  getSupportedVoices: () => Promise.resolve({ voices }),
  isLanguageSupported: () => Promise.resolve({ supported: languageSupported }),
};

/**
 * The mock is a Proxy, not the plain object it would be natural to write.
 *
 * Capacitor hands out a Proxy that turns ANY property read into a native call, so touching a property
 * the plugin does not implement throws. This matters for exactly one property: promise resolution
 * reads `.then` to decide whether a value is thenable, so resolving a promise WITH the plugin makes
 * the app die on `"TextToSpeech.then()" is not implemented on android`. A plain-object mock resolves
 * happily and hides it — which is how the bug reached the emulator before this test existed.
 */
const IMPLEMENTED = new Set(['speak', 'stop', 'getSupportedVoices', 'isLanguageSupported']);
const pluginProxy = new Proxy(plugin, {
  get(target, prop) {
    if (typeof prop === 'symbol') return undefined;
    if (IMPLEMENTED.has(prop)) return target[prop as keyof typeof plugin];
    throw new Error(`"TextToSpeech.${String(prop)}()" is not implemented on android`);
  },
});

vi.mock('@capacitor-community/text-to-speech', () => ({ TextToSpeech: pluginProxy }));

/** Module state is per-import, so every test gets a fresh engine. */
async function freshEngine() {
  vi.resetModules();
  const mod = await import('./native');
  // Let the availability probe and the voice load settle before asserting on either.
  await vi.waitUntil(() => mod.nativeEngine.englishVoices().length > 0 || !mod.nativeEngine.available(), {
    timeout: 1000,
  });
  return mod.nativeEngine;
}

beforeEach(() => {
  spoken = [];
  settle = null;
  stopped = 0;
  languageSupported = true;
  voices = VOICES;
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'Capacitor');
});

test('the voice index counts the RAW list, not the English-only view', async () => {
  const engine = await freshEngine();
  engine.setPreferredVoiceURI('en-us-x-sfg#female_1-local');

  engine.speak('Hello', {});
  await vi.waitUntil(() => spoken.length > 0);

  // 3 is its position among ALL voices. The English-only view would have said 2 — the network one.
  expect(spoken[0]!.voice).toBe(3);
});

test('an unknown voice falls back to the automatic pick instead of speaking with none', async () => {
  const engine = await freshEngine();
  // What a voice chosen in the browser looks like once it reaches a phone that has never heard of it.
  engine.setPreferredVoiceURI('Google UK English Male');

  engine.speak('Hello', {});
  await vi.waitUntil(() => spoken.length > 0);

  // en-US and local beats both en-GB and the en-US that needs the network.
  expect(spoken[0]!.voice).toBe(3);
});

test('cancelling before the in-flight await resolves keeps the utterance from ever being spoken', async () => {
  const engine = await freshEngine();

  engine.speak('Hello', {});
  engine.cancel(); // same tick, exactly as readSentence does

  await new Promise((r) => setTimeout(r, 50));
  expect(spoken).toEqual([]);
  expect(stopped).toBe(1);
});

test('a chunk cancelled mid-speech does not report its end, so the chain stops', async () => {
  const engine = await freshEngine();
  const events: string[] = [];

  engine.speak('Hello', { onStart: () => events.push('start'), onEnd: () => events.push('end') });
  await vi.waitUntil(() => spoken.length > 0);
  expect(events).toEqual(['start']);

  engine.cancel();
  settle?.resolve(); // the plugin would not fire this after a stop, but nothing may depend on that
  await new Promise((r) => setTimeout(r, 20));

  expect(events).toEqual(['start']);
  expect(engine.isSpeaking()).toBe(false);
});

test('a rejected utterance advances the passage instead of stalling it', async () => {
  const engine = await freshEngine();
  const events: string[] = [];

  engine.speak('Hello', { onEnd: () => events.push('end'), onError: () => events.push('error') });
  await vi.waitUntil(() => spoken.length > 0);
  settle?.reject();
  await vi.waitUntil(() => events.length > 0);

  expect(events).toEqual(['error']);
});

test('voices are labelled from the id, because every Android name is the same string', async () => {
  const engine = await freshEngine();

  const list = engine.englishVoices();

  // Both would read "English United Kingdom" / "English United States" without this.
  expect(list.map((v) => v.name)).toEqual([
    'en-GB male 2 · network',
    'en-US male 3 · network',
    'en-US female 1 · local',
  ]);
});

test('voices present but no en-US data means unavailable, not ready', async () => {
  languageSupported = false;
  const engine = await freshEngine();

  // It answers `true` first and corrects itself: nothing can be known synchronously, and the plugin
  // rejects everything during its own init, so one retry is the difference between "no engine on this
  // device" and "asked too early". The read-aloud button is therefore briefly offered and withdrawn —
  // deliberate, and the reason `subscribeVoices` exists for the UI to re-render on.
  expect(engine.available()).toBe(true);

  await vi.waitUntil(() => !engine.available(), { timeout: 5000 });
  expect(engine.available()).toBe(false);
  expect(spoken).toEqual([]);
});
