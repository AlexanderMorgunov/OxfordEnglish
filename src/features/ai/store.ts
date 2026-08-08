import { create } from 'zustand';
import type { AiConfig } from './provider';

const KEY = 'oxford-ai-config';

function load(): AiConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AiConfig) : null;
  } catch {
    return null;
  }
}

type AiState = {
  config: AiConfig | null;
  setConfig: (config: AiConfig | null) => void;
};

export const useAiStore = create<AiState>((set) => ({
  config: load(),
  setConfig: (config) => {
    try {
      if (config) localStorage.setItem(KEY, JSON.stringify(config));
      else localStorage.removeItem(KEY);
    } catch {
      // ignore storage failures
    }
    set({ config });
  },
}));

export function isConfigured(config: AiConfig | null): config is AiConfig {
  return Boolean(config?.apiKey && config.model);
}
