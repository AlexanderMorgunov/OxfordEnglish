import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { useAiStore } from './store';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { invalidateDataScope } from '@/features/account/dataScope';
import { AiCacheMiss } from './cache';
import { aiTranslate } from './functions';
import { translatePassage } from '@/features/vocab/text-workbench';

const run = vi.hoisted(() => vi.fn());
vi.mock('./route', async original => ({ ...await original<object>(), runTaskResult: run }));
beforeEach(async () => {
  invalidateDataScope(); run.mockReset(); useAiStore.setState({ config: null });
  useAccount.setState({ status: 'anonymous', accountId: null }); useEntitlement.setState({ entitlement: null });
  await db.open(); await db.translations.clear();
});

test('cache-only can return a previous managed translation without a plan or key', async () => {
  await db.translations.put({ word: 'text-workbench:ai :v2 managed:Read this.', ru: 'Прочитай это.', source: 'ai' });
  expect(await aiTranslate(null, 'Read this.', { cacheOnly: true, cachePrefix: 'text-workbench:ai ' })).toBe('Прочитай это.');
  expect(run).not.toHaveBeenCalled();
});

test('cache-only never starts a paid request on a miss, even when Pro is available', async () => {
  useAccount.setState({ status: 'authenticated', accountId: 'fixture-owner' });
  useEntitlement.setState({ entitlement: { plan: 'pro', active: true, ai: { used: 0, limit: 100 } } });
  await expect(aiTranslate(null, 'Read this.', { cacheOnly: true, cachePrefix: 'text-workbench:ai ' })).rejects.toBeInstanceOf(AiCacheMiss);
  expect(run).not.toHaveBeenCalled();
});

test('cache-only passages retain saved parts and stop before a missing part reaches a provider', async () => {
  await db.translations.put({ word: 'text-workbench:ai :v2 managed:Read this.', ru: 'Прочитай это.', source: 'ai' });
  const progress = vi.fn();
  await expect(translatePassage('Read this.\n\nSave that.', { mode: 'ai', config: null, cacheOnly: true, signal: new AbortController().signal, onProgress: progress })).rejects.toBeInstanceOf(AiCacheMiss);
  expect(progress).toHaveBeenLastCalledWith('Прочитай это.', ['managed'], { completed: 1, total: 2 });
  expect(run).not.toHaveBeenCalled();
});
