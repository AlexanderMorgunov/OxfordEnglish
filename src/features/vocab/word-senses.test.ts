import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { releasePreviousAccountData } from '@/features/sync/engine';
import * as AccountApi from '@/features/account/api';
import { cachedWordSenses, requestWordSenses, SENSE_CACHE_PREFIX, SENSE_CACHE_TTL } from './word-senses';

const config = { provider: 'custom' as const, apiKey: 'test-only', model: 'test-only', baseUrl: 'https://a.invalid' };
const senses = [{ partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'We sat on the bank.' }];
const content = JSON.stringify({ senses });
const response = () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
const signal = () => new AbortController().signal;
beforeEach(async () => {
  useAccount.setState({ status: 'anonymous' }); useEntitlement.setState({ entitlement: null });
  await db.open(); await db.translations.clear();
  vi.stubGlobal('fetch', vi.fn(async () => response()));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('BYOK cached proposals do not mix endpoints/models; local hit makes no paid request', async () => {
  expect((await requestWordSenses('bank', config, signal())).cached).toBe(false);
  expect((await requestWordSenses('bank', config, signal())).cached).toBe(true);
  await requestWordSenses('bank', { ...config, baseUrl: 'https://b.invalid' }, signal());
  await requestWordSenses('bank', { ...config, model: 'other' }, signal());
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(await db.translations.count()).toBe(3);
  expect((await db.translations.toCollection().primaryKeys()).every(key => /\s/.test(String(key)))).toBe(true);
});
test('expired trial with no BYOK can discover managed cache offline without runTask', async () => {
  await db.translations.put({ word: `${SENSE_CACHE_PREFIX}managed:bank`, source: 'lens-word-senses', ru: JSON.stringify({ version: 'v1', at: Date.now(), path: 'managed', content }) });
  expect(await cachedWordSenses('bank', null, signal())).toEqual({ senses, path: 'managed', cached: true });
  expect((await requestWordSenses('bank', null, signal())).cached).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
test.each(['expired', 'future', 'malformed', 'wrong-version', 'wrong-target'] as const)('invalid %s cache never triggers a request without eligibility', async reason => {
  const value = { version: reason === 'wrong-version' ? 'v0' : 'v1', at: Date.now() - (reason === 'expired' ? SENSE_CACHE_TTL : reason === 'future' ? -60000 : 0), path: 'managed', content: reason === 'wrong-target' ? content.replace('bank.', 'river.') : content };
  await db.translations.put({ word: `${SENSE_CACHE_PREFIX}managed:bank`, source: 'lens-word-senses', ru: reason === 'malformed' ? 'invalid' : JSON.stringify(value) });
  expect(await cachedWordSenses('bank', null, signal())).toBeNull();
  await expect(requestWordSenses('bank', null, signal())).rejects.toThrow('AI unavailable');
  expect(fetch).not.toHaveBeenCalled();
});
test.each(['abort', 'owner'] as const)('cache write rolls back on %s invalidation and cannot publish a late result', async action => {
  const controller = new AbortController();
  const put = db.translations.put.bind(db.translations);
  vi.spyOn(db.translations, 'put').mockImplementation((...args) => put(...args).then(key => {
    if (action === 'abort') controller.abort(); else invalidateDataScope();
    return key;
  }));
  await expect(requestWordSenses('bank', config, controller.signal)).rejects.toThrow();
  expect(await db.translations.count()).toBe(0);
});
test('cancellation while computing provider identity never becomes a cache miss or provider request', async () => {
  const controller = new AbortController();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args) => { const value = await digest(...args); controller.abort(); return value; });
  await expect(requestWordSenses('bank', config, controller.signal)).rejects.toThrow('Aborted');
  expect(fetch).not.toHaveBeenCalled();
});
test('storage failure returns validated proposals; malformed/truncated provider results never cache', async () => {
  vi.spyOn(db.translations, 'put').mockRejectedValueOnce(new Error('Storage unavailable'));
  expect((await requestWordSenses('bank', config, signal())).senses).toEqual(senses);
  expect(await db.translations.count()).toBe(0);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'bad json' } }] })));
  await expect(requestWordSenses('bank', config, signal())).rejects.toThrow('Invalid word senses');
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content } }] })));
  await expect(requestWordSenses('bank', config, signal())).rejects.toThrow('truncated');
  expect(await db.translations.count()).toBe(0);
});
test('handover clears one-word sense cache while preserving ordinary manual translations', async () => {
  await requestWordSenses('bank', config, signal());
  await db.translations.put({ word: 'bank', ru: 'банк', source: 'manual' });
  await releasePreviousAccountData();
  expect(await db.translations.toArray()).toEqual([{ word: 'bank', ru: 'банк', source: 'manual' }]);
});
test('cache maintenance only evicts this namespace and keeps its count bounded', async () => {
  await db.translations.bulkPut(Array.from({ length: 100 }, (_, index) => ({ word: `${SENSE_CACHE_PREFIX}managed:word${index}`, source: 'lens-word-senses', ru: JSON.stringify({ version: 'v1', at: Date.now() - 1000 - index, path: 'managed', content }) })));
  await db.translations.put({ word: 'bank', ru: 'ручной', source: 'manual' });
  await requestWordSenses('bank', config, signal());
  expect(await db.translations.where('word').startsWith(SENSE_CACHE_PREFIX).count()).toBe(100);
  expect((await db.translations.get('bank'))?.ru).toBe('ручной');
});

test('case-sensitive meanings have distinct cache identities, matching prompt semantics', async () => {
  const make = (term: string) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ senses: [{ ...senses[0], example: `I said ${term}.` }] }) } }] }));
  vi.mocked(fetch).mockResolvedValueOnce(make('US')).mockResolvedValueOnce(make('us'));
  await requestWordSenses('US', config, signal());
  await requestWordSenses('us', config, signal());
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await db.translations.count()).toBe(2);
});
test('a managed invocation stays pinned when entitlement expires during cache lookup', async () => {
  useAccount.setState({ status: 'authenticated', getAccessToken: async () => 'test-only' });
  useEntitlement.setState({ entitlement: { plan: 'trial', active: true, ai: { used: 0, limit: 100 } } });
  const get = db.translations.get.bind(db.translations);
  vi.spyOn(db.translations, 'get').mockImplementation((...args) => get(...args).then(row => {
    useEntitlement.setState({ entitlement: { plan: 'trial', active: false, trialEndsAt: Date.now() - 1, ai: { used: 0, limit: 100 } } });
    return row;
  }));
  const managed = vi.spyOn(AccountApi, 'aiComplete').mockResolvedValue({ content, cached: false, ai: { used: 4, limit: 100 } });
  expect((await requestWordSenses('bank', config, signal())).path).toBe('managed');
  expect(managed).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
});

test('manual prefix collisions are preserved during cache writing and eviction', async () => {
  await requestWordSenses('bank', config, signal());
  const key = (await db.translations.toCollection().primaryKeys())[0];
  if (typeof key !== 'string') throw new Error('Missing cache key');
  await db.translations.put({ word: key, ru: 'ручной ответ', source: 'manual' });
  await db.translations.put({ word: `${SENSE_CACHE_PREFIX}manual-collision`, ru: 'ещё ручной', source: 'manual' });
  await requestWordSenses('bank', config, signal());
  expect((await db.translations.get(key))?.ru).toBe('ручной ответ');
  await requestWordSenses('bank', { ...config, model: 'other' }, signal());
  expect((await db.translations.get(`${SENSE_CACHE_PREFIX}manual-collision`))?.ru).toBe('ещё ручной');
});
