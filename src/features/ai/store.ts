import { create } from 'zustand';
import type { AiConfig, AiProviderId } from './provider';

const KEY = 'oxford-ai-config';
const KEYS = 'oxford-ai-keys';

/** Per-provider remembered credentials, so switching providers restores that provider's key. */
type StoredKey = { apiKey: string; model: string; baseUrl?: string };
type KeyMap = Partial<Record<AiProviderId, StoredKey>>;

function loadConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AiConfig) : null;
  } catch {
    return null;
  }
}

function loadKeys(config: AiConfig | null): KeyMap {
  try {
    const raw = localStorage.getItem(KEYS);
    if (raw) return JSON.parse(raw) as KeyMap;
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

function persist(config: AiConfig | null, keys: KeyMap): void {
  try {
    if (config) localStorage.setItem(KEY, JSON.stringify(config));
    else localStorage.removeItem(KEY);
    localStorage.setItem(KEYS, JSON.stringify(keys));
  } catch {
    // ignore storage failures
  }
}

type AiState = {
  config: AiConfig | null;
  keys: KeyMap;
  setConfig: (config: AiConfig | null) => void;
  /** Forget a provider's remembered key; deactivates it if it was the active config. */
  forgetKey: (provider: AiProviderId) => void;
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
      persist(config, keys);
      set({ config, keys });
    },
    forgetKey: (provider) => {
      const keys = { ...get().keys };
      delete keys[provider];
      const next = get().config?.provider === provider ? null : get().config;
      persist(next, keys);
      set({ config: next, keys });
    },
  };
});

export function isConfigured(config: AiConfig | null): config is AiConfig {
  return Boolean(config?.apiKey && config.model);
}
