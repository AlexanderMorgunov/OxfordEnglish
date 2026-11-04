import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useAiStore } from './store';

const groq = { provider: 'groq', apiKey: 'synthetic-key', model: 'synthetic-model' } as const;
beforeEach(() => {
  localStorage.removeItem('oxford-ai-config'); localStorage.removeItem('oxford-ai-keys');
  useAiStore.setState({ config: null, keys: {} });
});
afterEach(() => vi.restoreAllMocks());

test('storage denial cannot activate an unsaved key', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  expect(useAiStore.getState().setConfig(groq)).toBe(false);
  expect(useAiStore.getState().config).toBeNull();
  expect(useAiStore.getState().keys).toEqual({});
});

test('a partial two-key write rolls back the remembered keys and keeps the active provider', () => {
  useAiStore.getState().setConfig(groq);
  const prior = localStorage.getItem('oxford-ai-keys');
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(this: Storage, key, value) {
    if (key === 'oxford-ai-config') throw new Error('full');
    original.call(this, key, value);
  });
  expect(useAiStore.getState().setConfig({ ...groq, provider: 'openai' })).toBe(false);
  expect(useAiStore.getState().config).toEqual(groq);
  expect(localStorage.getItem('oxford-ai-keys')).toBe(prior);
});

test('forgetting one provider keeps the others and deactivates only its own config', () => {
  useAiStore.getState().setConfig(groq);
  const other = { ...groq, provider: 'openai' } as const;
  useAiStore.getState().setConfig(other);
  expect(useAiStore.getState().forgetKey('groq')).toBe(true);
  expect(useAiStore.getState().config).toEqual(other);
  expect(useAiStore.getState().keys.groq).toBeUndefined();
  useAiStore.getState().forgetKey('openai');
  expect(useAiStore.getState().config).toBeNull();
});
