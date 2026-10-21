import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as api from '@/features/account/api';
import { ApiFailure } from '@/features/account/api';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { complete } from './provider';
import { useAiStore } from './store';
import { AI_AUTH_TIMEOUT, AI_ATTEMPT_TIMEOUT, runTaskResult } from './route';
import { aiTranslate, aiSimplify, aiGrammar } from './functions';
import { db } from '@/db/db';
import { requestWordSenses } from '@/features/vocab/word-senses';
import { translatePassage, type PassageResume } from '@/features/vocab/text-workbench';

const config = { provider: 'custom' as const, apiKey: 'synthetic-key', model: 'synthetic-model', baseUrl: 'https://ai.invalid' };
const task = { task: 'translate' as const, text: 'Hello' };
const plan = { plan: 'pro' as const, active: true, ai: { used: 0, limit: 100 } };
const answer = (content = 'Перевод') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(async () => {
  useEntitlement.getState().clear();
  useEntitlement.setState({ entitlement: plan });
  useAccount.setState({ status: 'authenticated', accountId: 'synthetic-owner', getAccessToken: async () => 'synthetic-token' });
  useAiStore.getState().setConfig(config);
  await db.open(); await db.translations.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test.each(['known', 'unknown'] as const)('Pro without a personal key can use managed AI with %s entitlement', async state => {
  useAiStore.getState().setConfig(null);
  if (state === 'unknown') useEntitlement.setState({ entitlement: null });
  const managed = vi.spyOn(api, 'aiComplete').mockResolvedValue({ content: 'Ответ Pro', cached: false, ai: plan.ai });
  const byok = vi.fn();
  expect(await runTaskResult(task, null, byok)).toEqual({ content: 'Ответ Pro', path: 'managed' });
  expect(managed).toHaveBeenCalledOnce();
  expect(byok).not.toHaveBeenCalled();
});

test('Pro without a key translates a passage and requests meanings entirely through managed AI', async () => {
  useAiStore.getState().setConfig(null);
  const senses = [{ partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'We sat on the bank.' }];
  const managed = vi.spyOn(api, 'aiComplete').mockImplementation(async (_token, request) => ({
    content: request.task === 'wordSenses' ? JSON.stringify({ senses }) : 'Перевод Pro', cached: false, ai: plan.ai,
  }));
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(await translatePassage('First.\n\nSecond.', { mode: 'ai', config: null, signal: new AbortController().signal })).toBe('Перевод Pro\n\nПеревод Pro');
  expect(await requestWordSenses('bank', null, new AbortController().signal)).toEqual({ senses, path: 'managed', cached: false });
  expect(managed).toHaveBeenCalledTimes(3);
  expect(fetcher).not.toHaveBeenCalled();
});

test('Pro without a key retains its plan on network failure and the next request recovers without restart', async () => {
  useAiStore.getState().setConfig(null);
  vi.spyOn(api, 'aiComplete').mockRejectedValueOnce(new ApiFailure('network', 0))
    .mockResolvedValueOnce({ content: 'Связь восстановлена', cached: false, ai: plan.ai });
  const byok = vi.fn();
  await expect(runTaskResult(task, null, byok)).rejects.toMatchObject({ code: 'network' });
  expect(useEntitlement.getState().entitlement?.plan).toBe('pro');
  expect(await runTaskResult(task, null, byok)).toEqual({ content: 'Связь восстановлена', path: 'managed' });
  expect(byok).not.toHaveBeenCalled();
});

test('Pro without a key exits a stalled request at its deadline and can retry', async () => {
  useAiStore.getState().setConfig(null);
  vi.useFakeTimers();
  vi.spyOn(api, 'aiComplete').mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce({ content: 'Ответ после сбоя', cached: false, ai: plan.ai });
  const byok = vi.fn();
  const failed = expect(runTaskResult(task, null, byok)).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(AI_ATTEMPT_TIMEOUT);
  await failed;
  expect(await runTaskResult(task, null, byok)).toEqual({ content: 'Ответ после сбоя', path: 'managed' });
  expect(byok).not.toHaveBeenCalled();
});

test('hanging shared refresh stops blocking AI at its budget without cancelling refresh', async () => {
  vi.useFakeTimers();
  const token = deferred<string>();
  useAccount.setState({ getAccessToken: () => token.promise });
  const byok = vi.fn(async () => 'own key');
  const request = runTaskResult(task, config, byok);
  await vi.advanceTimersByTimeAsync(AI_AUTH_TIMEOUT);
  expect(await request).toEqual({ content: 'own key', path: 'byok' });
  token.resolve('late token');
  expect(await token.promise).toBe('late token');
  expect(byok).toHaveBeenCalledOnce();
});

test('managed timeout aborts its transport and falls back only once', async () => {
  vi.useFakeTimers();
  let managedSignal: AbortSignal | undefined;
  vi.spyOn(api, 'aiComplete').mockImplementation((_token, _task, signal) => { managedSignal = signal; return new Promise(() => {}); });
  const byok = vi.fn(async () => 'own key');
  const request = runTaskResult(task, config, byok);
  await vi.advanceTimersByTimeAsync(AI_ATTEMPT_TIMEOUT);
  expect(await request).toEqual({ content: 'own key', path: 'byok' });
  expect(managedSignal?.aborted).toBe(true);
  expect(byok).toHaveBeenCalledOnce();
});

test.each(['cancel', 'key', 'account'] as const)('%s invalidation during auth wait cannot send fallback', async reason => {
  const token = deferred<string>();
  useAccount.setState({ getAccessToken: () => token.promise });
  const controller = new AbortController();
  const byok = vi.fn();
  const request = runTaskResult(task, config, byok, { signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  if (reason === 'cancel') controller.abort();
  if (reason === 'key') useAiStore.getState().forgetKey('custom');
  if (reason === 'account') useAccount.setState({ accountId: 'another-owner' });
  await rejected;
  token.resolve('late');
  expect(byok).not.toHaveBeenCalled();
});

test('invalid input does not spend BYOK credit to mask a contract error', async () => {
  vi.spyOn(api, 'aiComplete').mockRejectedValue(new ApiFailure('bad_request', 400));
  const byok = vi.fn();
  await expect(runTaskResult(task, config, byok)).rejects.toMatchObject({ status: 400 });
  expect(byok).not.toHaveBeenCalled();
});

test('BYOK body hang is bounded even after response headers arrive', async () => {
  vi.useFakeTimers();
  useEntitlement.setState({ entitlement: { ...plan, active: false } });
  const response = answer();
  vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', vi.fn(async () => response));
  const request = complete(config, []);
  const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
  // IndexedDB and digest complete on real event-loop tasks before the network budget begins.
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(AI_ATTEMPT_TIMEOUT);
  await rejection;
  expect(fetch).toHaveBeenCalledOnce();
});

test('fallback cache records actual source and remains available with unreadable entitlement', async () => {
  const managed = vi.spyOn(api, 'aiComplete').mockRejectedValue(new ApiFailure('network', 0));
  vi.stubGlobal('fetch', vi.fn(async () => answer()));
  const onSource = vi.fn();
  expect(await aiTranslate(config, 'Hello', { onSource })).toBe('Перевод');
  expect(onSource).toHaveBeenLastCalledWith('byok', false);
  const rows = await db.translations.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0]?.word).toContain('v2 byok');
  expect(rows[0]?.word).not.toContain(config.apiKey);
  useEntitlement.setState({ entitlement: null });
  expect(await aiTranslate(config, 'Hello', { onSource })).toBe('Перевод');
  expect(managed).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});

test('managed cached translations remain readable after subscription expiry with no key', async () => {
  const managed = vi.spyOn(api, 'aiComplete').mockResolvedValue({ content: 'Привет', cached: false, ai: plan.ai });
  expect(await aiTranslate(null, 'Hello')).toBe('Привет');
  useEntitlement.setState({ entitlement: { ...plan, active: false } });
  expect(await aiTranslate(null, 'Hello')).toBe('Привет');
  expect(managed).toHaveBeenCalledOnce();
});

test('legacy reader AI cache remains readable offline without claiming an unverified provider', async () => {
  useEntitlement.setState({ entitlement: { ...plan, active: false } });
  await db.translations.put({ word: 'ai:managed:Hello', ru: 'Старый перевод', source: 'ai' });
  const managed = vi.spyOn(api, 'aiComplete');
  const onSource = vi.fn();
  expect(await aiTranslate(null, 'Hello', { onSource })).toBe('Старый перевод');
  expect(onSource).not.toHaveBeenCalled();
  expect(managed).not.toHaveBeenCalled();
});

test.each([aiSimplify, aiGrammar])('managed lens cancellation reaches transport and blocks cache writes', async helper => {
  const controller = new AbortController();
  const response = deferred<Awaited<ReturnType<typeof api.aiComplete>>>();
  const managed = vi.spyOn(api, 'aiComplete').mockReturnValue(response.promise);
  const request = helper(config, 'The man went home.', { signal: controller.signal });
  const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(managed).toHaveBeenCalled());
  controller.abort(); await rejected;
  expect(managed.mock.calls[0]?.[2]?.aborted).toBe(true);
  response.resolve({ content: 'Человек пошёл домой', cached: false, ai: plan.ai });
  await Promise.resolve();
  expect(await db.translations.count()).toBe(0);
});

test('word meanings fall back and correctly cache the BYOK result', async () => {
  vi.spyOn(api, 'aiComplete').mockRejectedValue(new ApiFailure('ai_unavailable', 503));
  const senses = [{ partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'We sat on the bank.' }];
  vi.stubGlobal('fetch', vi.fn(async () => answer(JSON.stringify({ senses }))));
  expect(await requestWordSenses('bank', config, new AbortController().signal)).toEqual({ senses, path: 'byok', cached: false });
  expect(await requestWordSenses('bank', config, new AbortController().signal)).toEqual({ senses, path: 'byok', cached: true });
  expect(fetch).toHaveBeenCalledOnce();
});

test('retrying a failed passage reuses completed fragments across provider changes', async () => {
  const managed = vi.spyOn(api, 'aiComplete').mockResolvedValueOnce({ content: 'Первая часть', cached: false, ai: plan.ai }).mockRejectedValue(new ApiFailure('network', 0));
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(answer('Вторая часть'));
  vi.stubGlobal('fetch', fetcher);
  const text = 'First paragraph.\n\nSecond paragraph.';
  const onProgress = vi.fn();
  const options = { mode: 'ai' as const, config, signal: new AbortController().signal, onProgress };
  await expect(translatePassage(text, options)).rejects.toThrow('offline');
  expect(onProgress).toHaveBeenLastCalledWith('Первая часть', ['managed'], { completed: 1, total: 2 });
  useEntitlement.setState({ entitlement: { ...plan, active: false } });
  expect(await translatePassage(text, options)).toBe('Первая часть\n\nВторая часть');
  expect(managed).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('a cached BYOK fragment does not redirect fresh work away from healthy Pro', async () => {
  useEntitlement.setState({ entitlement: { ...plan, active: false } });
  vi.stubGlobal('fetch', vi.fn(async () => answer('Сохранённая часть')));
  const options = { mode: 'ai' as const, config, signal: new AbortController().signal };
  await translatePassage('First paragraph.', options);
  useEntitlement.setState({ entitlement: plan });
  const managed = vi.spyOn(api, 'aiComplete').mockResolvedValue({ content: 'Новая часть Pro', cached: false, ai: plan.ai });
  expect(await translatePassage('First paragraph.\n\nNew paragraph.', options)).toBe('Сохранённая часть\n\nНовая часть Pro');
  expect(managed).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});

test('in-memory passage progress avoids repeating completed work when cache writes fail', async () => {
  useEntitlement.setState({ entitlement: { ...plan, active: false } });
  vi.spyOn(db.translations, 'put').mockRejectedValue(new Error('Storage full'));
  const fetcher = vi.fn().mockResolvedValueOnce(answer('Первая часть'))
    .mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(answer('Вторая часть'));
  vi.stubGlobal('fetch', fetcher);
  const resume: PassageResume = new Map();
  const options = { mode: 'ai' as const, config, signal: new AbortController().signal, resume };
  await expect(translatePassage('First.\n\nSecond.', options)).rejects.toThrow('offline');
  expect(await db.translations.count()).toBe(0);
  expect(await translatePassage('First.\n\nSecond.', options)).toBe('Первая часть\n\nВторая часть');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
