import { create } from 'zustand';
import { PROVIDERS, type AiConfig, type AiProviderId } from './provider';

const KEY = 'oxford-ai-config';
const KEYS = 'oxford-ai-keys';

/** Per-provider remembered credentials, so switching providers restores that provider's key. */
type StoredKey = { apiKey: string; model: string; baseUrl?: string };
type KeyMap = Partial<Record<AiProviderId, StoredKey>>;

function loadConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AiConfig> | null;
    // Drop a config that points at a provider we no longer ship, so nothing reads PROVIDERS[undefined].
    return parsed && typeof parsed.provider === 'string' && Object.hasOwn(PROVIDERS, parsed.provider) &&
      typeof parsed.apiKey === 'string' && typeof parsed.model === 'string' &&
      (parsed.baseUrl === undefined || typeof parsed.baseUrl === 'string') ? parsed as AiConfig : null;
  } catch {
    return null;
  }
}

function loadKeys(config: AiConfig | null): KeyMap {
  try {
    const raw = localStorage.getItem(KEYS);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed).filter(([id, value]) =>
          Object.hasOwn(PROVIDERS, id) && value && typeof value === 'object' &&
          typeof value.apiKey === 'string' && typeof value.model === 'string' &&
          (value.baseUrl === undefined || typeof value.baseUrl === 'string')
        ));
      }
    }
  } catch {
    // ignore
  }
  // First run after this feature: seed from the legacy single config so the current key isn't lost.
  if (config?.apiKey && config.model) {
    return {
      [config.provider]: { apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl },
    };
  }
  return {};
}

function persist(config: AiConfig | null, keys: KeyMap): boolean {
  let previousKeys: string | null = null;
  let keysWritten = false;
  try {
    previousKeys = localStorage.getItem(KEYS);
    localStorage.setItem(KEYS, JSON.stringify(keys));
    keysWritten = true;
    if (config) localStorage.setItem(KEY, JSON.stringify(config));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    if (keysWritten) {
      try {
        if (previousKeys === null) localStorage.removeItem(KEYS);
        else localStorage.setItem(KEYS, previousKeys);
      } catch { /* The caller keeps the draft and reports that persistence failed. */ }
    }
    return false;
  }
}

type AiState = {
  config: AiConfig | null;
  keys: KeyMap;
  setConfig: (config: AiConfig | null) => boolean;
  /** Forget a provider's remembered key; deactivates it if it was the active config. */
  forgetKey: (provider: AiProviderId) => boolean;
};

export const useAiStore = create<AiState>((set, get) => {
  const config = loadConfig();
  return {
    config,
    keys: loadKeys(config),
    setConfig: (config) => {
      const keys = { ...get().keys };
      if (config?.apiKey && config.model) {
        keys[config.provider] = {
          apiKey: config.apiKey,
          model: config.model,
          baseUrl: config.baseUrl,
        };
      }
      if (!persist(config, keys)) return false;
      set({ config, keys });
      return true;
    },
    forgetKey: (provider) => {
      const keys = { ...get().keys };
      delete keys[provider];
      const next = get().config?.provider === provider ? null : get().config;
      if (!persist(next, keys)) return false;
      set({ config: next, keys });
      return true;
    },
  };
});

export function isConfigured(config: AiConfig | null): config is AiConfig {
  return Boolean(config?.apiKey && config.model);
}
