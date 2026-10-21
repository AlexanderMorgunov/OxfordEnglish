import { createApp } from './app.js';
import { InMemoryEntitlementStore } from './entitlements.js';
import { InMemoryAiCacheStore } from './ai.js';
import type { AiCompleteResponse } from './contract.js';

process.env.DEEPSEEK_API_KEY = 'stub-key-for-smoke';
const ent = new InMemoryEntitlementStore();
const cache = new InMemoryAiCacheStore();
let getFails = false;
let putFails = false;
let upstreamFails = false;
let calls = 0;
const app = createApp(undefined, undefined, undefined, ent, {
  get: async key => { if (getFails) throw new Error('Synthetic cache read failure'); return cache.get(key); },
  put: async (...args) => { if (putFails) throw new Error('Synthetic cache write failure'); await cache.put(...args); },
}, async () => {
  calls += 1;
  if (upstreamFails) throw new Error('Synthetic upstream failure');
  return 'Synthetic translation';
});
let failures = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failures += 1; };
let ip = 1;
const post = (path: string, body: unknown, token?: string) => app.request(path, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${ip++}`,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body),
});
const account = 'acc-cache0123456789ab';
const registration = await post('/v1/auth/register', { accountId: account, verifier: 'verifier-cache-0123456789', deviceName: 'Smoke' });
const { accessToken } = await registration.json() as { accessToken: string };
await post('/v1/entitlement/trial', { installId: 'install-cache-0123456789' }, accessToken);
const used = async () => (await ent.get(account))?.aiUsed ?? 0;
const ask = (text: string) => post('/v1/ai', { task: 'translate', text }, accessToken);
for (const fault of ['read', 'write', 'both']) {
  getFails = fault !== 'write';
  putFails = fault !== 'read';
  const before = await used();
  const beforeCalls = calls;
  const response = await ask(`Cache fault ${fault}`);
  const body = await response.json().catch(() => null) as AiCompleteResponse | null;
  check(`${fault} fault preserves successful response`, response.status === 200 && body?.content === 'Synthetic translation' && body.cached === false);
  check(`${fault} fault calls provider once and charges once`, calls === beforeCalls + 1 && await used() === before + 1);
}
getFails = true; putFails = true; upstreamFails = true;
const beforeFailure = await used();
check('cache plus upstream failure returns 503', (await ask('Upstream failure')).status === 503);
check('failed upstream is refunded despite cache outage', await used() === beforeFailure);
getFails = false; putFails = false; upstreamFails = false;
await ask('Cached success');
const beforeHit = await used();
const beforeHitCalls = calls;
const hit = await ask('Cached success');
check('healthy cache preserves charged hit without upstream', (await hit.json() as AiCompleteResponse).cached && calls === beforeHitCalls && await used() === beforeHit + 1);
console.log(failures ? `AI cache faults: ${failures} FAILED` : 'AI cache faults: all checks passed');
process.exitCode = failures ? 1 : 0;
