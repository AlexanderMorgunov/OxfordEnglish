import type { SpeakHandlers, SpeechEngine, Voice } from './engine';
import { isNativePlatform } from '../platform';

export { isNativePlatform };

/**
 * Android synthesis through `@capacitor-community/text-to-speech`, for the WebView where
 * `speechSynthesis` does not exist at all.
 *
 * Everything the plugin offers is a promise and everything this interface promises is synchronous, so
 * the whole job here is holding a cache and never letting a stale `await` reach the plugin.
 */

type PluginVoice = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
};

type Plugin = {
  speak(o: { text: string; lang?: string; rate?: number; voice?: number }): Promise<void>;
  stop(): Promise<void>;
  getSupportedVoices(): Promise<{ voices: PluginVoice[] }>;
  isLanguageSupported(o: { lang: string }): Promise<{ supported: boolean }>;
};

const LANG = 'en-US';
const isEnglish = (lang: string) => /^en([-_]|$)/i.test(lang);

/**
 * The plugin is always handed around INSIDE this wrapper, never as a promise's value.
 *
 * Capacitor's plugin object is a Proxy that turns any property read into a native call, and promise
 * resolution reads `.then` on whatever it is given to see whether it is thenable. Resolving with the
 * proxy directly therefore invokes a native method named `then`, and the app dies with
 * `"TextToSpeech.then()" is not implemented on android`. A plain object is not thenable, so it passes
 * through untouched. Unit tests cannot catch this — a mock is an ordinary object.
 */
type Loaded = { api: Plugin } | null;

let plugin: Plugin | null = null;
let loading: Promise<Loaded> | null = null;

/**
 * Imported lazily. A static import would pull the plugin and `@capacitor/core` into the web bundle and
 * into every test's module graph, for code that only ever runs inside the app.
 */
function load(): Promise<Loaded> {
  if (plugin) return Promise.resolve({ api: plugin });
  loading ??= import('@capacitor-community/text-to-speech')
    .then((m) => {
      plugin = m.TextToSpeech as unknown as Plugin;
      return { api: plugin };
    })
    .catch(() => null);
  return loading;
}

/** Raw list, in the order the plugin returned it: `speak({voice})` indexes THIS array, unfiltered. */
let rawVoices: PluginVoice[] = [];
let englishView: Voice[] = [];
let indexByURI = new Map<string, number>();

let preferredVoiceURI: string | null = null;
let speaking = false;
/** Bumped by cancel; every await re-checks it before touching the plugin. */
let generation = 0;
let usable = true;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((l) => l());

/**
 * Android names every voice after its locale — `getDisplayLanguage() + getDisplayCountry()` — so a
 * picker showing `name` lists a dozen rows all reading "English United States". The distinguishing
 * detail is in the id (`en-us-x-sfg#male_1-local`), so the label is built from that instead.
 */
function labelFor(v: PluginVoice): string {
  const gender = /(male|female)[_-]?(\d+)?/i.exec(v.voiceURI);
  const variant = /-x-([a-z0-9]+)/i.exec(v.voiceURI)?.[1];
  const parts = [v.lang];
  if (gender) parts.push(gender[1]!.toLowerCase() + (gender[2] ? ` ${gender[2]}` : ''));
  else if (variant) parts.push(variant);
  return `${parts.join(' ')} · ${v.localService ? 'local' : 'network'}`;
}

/** Two voices can still land on the same label; fall back to the id rather than show a duplicate. */
function buildEnglishView(): Voice[] {
  const english = rawVoices.filter((v) => isEnglish(v.lang));
  const counts = new Map<string, number>();
  for (const v of english) {
    const l = labelFor(v);
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return english.map((v) => {
    const label = labelFor(v);
    return {
      voiceURI: v.voiceURI,
      name: counts.get(label)! > 1 ? `${label} (${v.voiceURI})` : label,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
    };
  });
}

/**
 * Local outranks everything a name might suggest, which is the opposite of the web heuristic.
 *
 * On the web a "Natural/Neural" name marks a better voice worth its latency. Here the names carry no
 * quality signal at all, while `localService` is exact: a network voice costs a round trip per
 * sentence and stops working offline, which an offline-first reader cannot accept as a default.
 */
function autoPickURI(): string | null {
  const english = rawVoices.filter((v) => isEnglish(v.lang));
  if (!english.length) return null;
  const score = (v: PluginVoice) =>
    (/^en-US$/i.test(v.lang) ? 8 : 0) + (v.localService ? 4 : 0) + (/#/.test(v.voiceURI) ? 1 : 0);
  return [...english].sort((a, b) => score(b) - score(a))[0]?.voiceURI ?? null;
}

async function loadVoices(): Promise<void> {
  const loaded = await load();
  if (!loaded) return;
  const res = await loaded.api.getSupportedVoices().catch(() => null);
  if (!res) return;
  rawVoices = res.voices;
  indexByURI = new Map(rawVoices.map((v, i) => [v.voiceURI, i]));
  englishView = buildEnglishView();
}

/**
 * A voice list alone does not mean speech works: `speak()` rejects with ERROR_UNSUPPORTED_LANGUAGE
 * when the engine has no en-US data downloaded, while still reporting voices. And both `speak` and
 * `stop` reject outright during the plugin's own async init, so one retry beats declaring failure.
 */
async function probe(): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const loaded = await load();
    if (loaded) {
      await loadVoices();
      const lang = await loaded.api.isLanguageSupported({ lang: LANG }).catch(() => null);
      if (lang?.supported && englishView.length > 0) {
        usable = true;
        notify();
        return;
      }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  usable = false;
  notify();
}

let probed = false;
function ensureProbed(): void {
  if (probed) return;
  probed = true;
  void probe();
}

function voiceIndex(): number | undefined {
  const uri = preferredVoiceURI && indexByURI.has(preferredVoiceURI) ? preferredVoiceURI : autoPickURI();
  return uri === null ? undefined : indexByURI.get(uri);
}

function run(text: string, uri: string | null, h: SpeakHandlers): void {
  const mine = generation;
  void (async () => {
    const loaded = await load();
    // Re-checked after every await: `readSentence` cancels and starts in the same tick, and a chunk
    // that resumed here afterwards would speak with the UI already showing "stopped".
    if (!loaded || mine !== generation) return;
    if (!rawVoices.length) {
      await loadVoices();
      if (mine !== generation) return;
    }
    const index = uri === null ? voiceIndex() : indexByURI.get(uri);
    speaking = true;
    h.onStart?.();
    try {
      // Resolves when the utterance FINISHES. A cancelled one never settles — the plugin's `stop()`
      // clears its request map without invoking callbacks — so the generation check above is what
      // keeps a stale chunk from ever reaching this point, not a rejection.
      await loaded.api.speak({ text, lang: LANG, rate: h.rate ?? 1, ...(index === undefined ? {} : { voice: index }) });
      if (mine !== generation) return;
      speaking = false;
      h.onEnd?.();
    } catch {
      if (mine !== generation) return;
      speaking = false;
      h.onError?.();
    }
  })();
}

export const nativeEngine: SpeechEngine = {
  available() {
    ensureProbed();
    return usable;
  },

  englishVoices() {
    ensureProbed();
    return englishView;
  },

  setPreferredVoiceURI(uri) {
    preferredVoiceURI = uri;
  },

  speak(text, handlers) {
    ensureProbed();
    run(text, null, handlers);
  },

  preview(text, voiceURI) {
    ensureProbed();
    run(text, voiceURI, {});
  },

  cancel() {
    generation += 1;
    speaking = false;
    // Straight to the plugin when it is already there, rather than through `load()`. The extra
    // promise hop costs nothing in the foreground and matters when the app is being backgrounded:
    // `visibilitychange` is the only chance to stop, and a throttled WebView may not get round to
    // the continuation for a second or more — which is audible as speech trailing the app away.
    // `.catch` on both paths: `stop()` rejects during the plugin's init window, and `cancelSpeech()`
    // runs on every vocabulary clip, so an unhandled rejection here would ride an ordinary tap.
    if (plugin) {
      void plugin.stop().catch(() => undefined);
      return;
    }
    void load().then((loaded) => loaded?.api.stop().catch(() => undefined));
  },

  isSpeaking: () => speaking,

  subscribeVoices(onChange) {
    listeners.add(onChange);
    ensureProbed();
    return () => listeners.delete(onChange);
  },
};
