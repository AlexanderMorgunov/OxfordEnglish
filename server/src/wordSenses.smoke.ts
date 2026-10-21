import { createApp } from './app.js';
import { InMemoryEntitlementStore } from './entitlements.js';
import { InMemoryAiCacheStore, aiCost, buildMessages } from './ai.js';
import { AiTaskRequestSchema } from './contract.js';
import { parseWordSenses, wordSensesMessages } from './wordSenses.js';
import type { Completer } from './aiProvider.js';

process.env.DEEPSEEK_API_KEY = 'stub-key-for-smoke';
const ent = new InMemoryEntitlementStore();
const cache = new InMemoryAiCacheStore();
const valid = JSON.stringify({ senses: [{ partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'We sat on the bank.' }] });
let answer = valid;
let getFails = false;
let putFails = false;
let corruptHit = false;
let calls = 0;
const completer: Completer = async (_messages, opts) => {
  calls += 1;
  if (opts.task !== 'wordSenses' || opts.maxTokens !== 700) throw new Error('Wrong pinned task');
  if (answer === 'upstream-failure') throw new Error('Upstream unavailable');
  return answer;
};
const app = createApp(undefined, undefined, undefined, ent, {
  get: async key => { if (getFails) throw new Error('Read failure'); return corruptHit ? 'corrupt' : cache.get(key); },
  put: async (...args) => { if (putFails) throw new Error('Write failure'); await cache.put(...args); },
}, completer);
const account = 'acc-senses0123456789';
let ip = 1;
const post = (path: string, body: unknown, token?: string) => app.request(path, { method: 'POST', headers: {
  'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${ip++}`,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
}, body: JSON.stringify(body) });
let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failures += 1; };
const registration = await post('/v1/auth/register', { accountId: account, verifier: 'verifier-senses-0123456789', deviceName: 'Smoke' });
const { accessToken } = await registration.json() as { accessToken: string };
const ask = (term = 'bank') => post('/v1/ai', { task: 'wordSenses', term }, accessToken);
const used = async () => (await ent.get(account))?.aiUsed ?? 0;
check('named task pins messages and four-unit cost', aiCost('wordSenses') === 4 && JSON.stringify(buildMessages({ task: 'wordSenses', term: 'bank' })) === JSON.stringify(wordSensesMessages('bank')));
check('no authentication rejected', (await post('/v1/ai', { task: 'wordSenses', term: 'bank' })).status === 401);
check('free account never reaches provider', (await ask()).status === 402 && calls === 0);
await post('/v1/entitlement/trial', { installId: 'install-senses-0123456789' }, accessToken);
check('unsupported input rejected before charge', (await ask('банк')).status === 400 && await used() === 0);
check('oversized input rejected before charge', (await ask('a'.repeat(81))).status === 400 && await used() === 0);
check('raw input cap enforced before normalization', !AiTaskRequestSchema.safeParse({ task: 'wordSenses', term: ' '.repeat(161) + 'bank' }).success);
const fresh = await ask();
const freshBody = await fresh.json() as { content: string; cached: boolean };
check('valid completion parsed and charged once', fresh.status === 200 && parseWordSenses(freshBody.content, 'bank').length === 1 && !freshBody.cached && await used() === 4 && calls === 1);
const hit = await ask();
check('validated cache hit costs same four units without provider', (await hit.json() as { cached: boolean }).cached && await used() === 8 && calls === 1);
getFails = true; putFails = true;
check('cache I/O failures preserve valid completion', (await ask()).status === 200 && await used() === 12 && calls === 2);
getFails = false; putFails = false; corruptHit = true;
check('corrupt hit regenerates under one charge', (await ask()).status === 200 && await used() === 16 && calls === 3);
for (const invalid of ['not-json', 'upstream-failure', JSON.stringify({ senses: [{ partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'A banker is here.' }] })]) {
  const before = await used(); answer = invalid;
  check('invalid fresh/upstream output refunds one charge', (await ask()).status === 503 && await used() === before);
}
answer = JSON.stringify({ senses: [] });
check('honest empty suggestions are supported', (await ask()).status === 200);
const beforeRace = await used();
let ordinal = 0;
const racingApp = createApp(undefined, undefined, undefined, ent, { get: async () => null, put: async () => {} }, async () => {
  const own = ordinal++; await new Promise(resolve => setTimeout(resolve, own ? 0 : 20));
  return own ? valid : 'invalid';
});
const statuses = await Promise.all([0, 1].map(async index => (await racingApp.request('/v1/ai', { method: 'POST', headers: {
  'content-type': 'application/json', authorization: `Bearer ${accessToken}`, 'x-forwarded-for': `198.51.100.${index+1}`,
}, body: JSON.stringify({ task: 'wordSenses', term: 'bank' }) })).status));
check('concurrent success and refund preserve exact net charge', statuses.includes(200) && statuses.includes(503) && await used() === beforeRace + 4);
const row = await ent.get(account);
if (!row) throw new Error('Missing entitlement');
await ent.put({ ...row, aiUsed: row.aiUsed + 10000 });
const beforeCalls = calls;
check('exhausted quota never reaches upstream', (await ask()).status === 429 && calls === beforeCalls);
console.log(failures ? `word senses: ${failures} FAILED` : 'word senses: all checks passed');
process.exitCode = failures ? 1 : 0;
