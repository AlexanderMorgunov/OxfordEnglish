/**
 * In-process smoke of the managed-AI route with a stub upstream (no network, no spend).
 * Run: `npx tsx src/aiApi.smoke.ts`.
 *
 * The cases that matter: a free account cannot spend our key at all, an exhausted quota stops paying
 * for work, a cache hit still costs quota (the trial's abuse bound), and a failed upstream is refunded.
 */
import { createApp } from './app.js';
import { InMemoryEntitlementStore, TRIAL_AI_REQUESTS } from './entitlements.js';
import { InMemoryAiCacheStore } from './ai.js';
import type { Completer } from './aiProvider.js';
import type { AiCompleteResponse } from './contract.js';

// `aiConfigured()` reads this per request, so setting it after the imports is fine. The upstream itself
// is stubbed below — no key is ever used.
process.env.DEEPSEEK_API_KEY = 'stub-key-for-smoke';

const ent = new InMemoryEntitlementStore();
const cache = new InMemoryAiCacheStore();

let upstreamCalls = 0;
let upstreamFails = false;
const completer: Completer = async (messages) => {
  upstreamCalls += 1;
  if (upstreamFails) throw new Error('upstream down');
  return `completion for: ${messages[messages.length - 1]?.content ?? ''}`;
};

const app = createApp(undefined, undefined, undefined, ent, cache, completer);
const H = { 'content-type': 'application/json' };
let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

const post = (path: string, body: unknown, token?: string) =>
  app.request(path, {
    method: 'POST',
    headers: token ? { ...H, authorization: `Bearer ${token}` } : H,
    body: JSON.stringify(body),
  });

async function register(id: string): Promise<string> {
  const r = await post('/v1/auth/register', { accountId: id, verifier: `verifier-${id}-0123456789`, deviceName: 'Smoke' });
  return ((await r.json()) as { accessToken: string }).accessToken;
}

const ACC = 'acc-aiaa0123456789ab';
const token = await register(ACC);
const ask = (body: unknown) => post('/v1/ai', body, token);

check('unauthenticated → 401', (await post('/v1/ai', { task: 'translate', text: 'x' })).status === 401);

// --- a free account may not spend our key ---
const free = await ask({ task: 'translate', text: 'the harpoon' });
check('free account → 402 no_plan', free.status === 402);
check('free account never reached the upstream', upstreamCalls === 0);

await post('/v1/entitlement/trial', { installId: 'install-ai-000000000' }, token);

// --- input cap: output is bounded by maxTokens, input is what an attacker inflates ---
const huge = await ask({ task: 'bookqa', pageText: 'x'.repeat(9000), question: 'why?' });
check('oversized input → 413', huge.status === 413);
check('oversized input never reached the upstream', upstreamCalls === 0);

const bad = await ask({ task: 'nonsense', text: 'x' });
check('unknown task → 400', bad.status === 400);

// --- happy path + cross-user cache ---
const first = await ask({ task: 'translate', text: 'the harpoon' });
const firstBody = (await first.json()) as AiCompleteResponse;
check('translate → 200 with content', first.status === 200 && firstBody.content.startsWith('completion for:'));
check('first call is a cache miss', firstBody.cached === false);
check('upstream called exactly once', upstreamCalls === 1);
check('quota charged', firstBody.ai.used === 1 && firstBody.ai.limit === TRIAL_AI_REQUESTS);

const second = await ask({ task: 'translate', text: '  the harpoon  ' });
const secondBody = (await second.json()) as AiCompleteResponse;
check('identical work hits the cache', secondBody.cached === true);
check('cache hit did NOT call the upstream', upstreamCalls === 1);
check('cache hit STILL charges quota (trial abuse bound)', secondBody.ai.used === 2);

// A second account must reuse the first account's entry — the whole point of a cross-user cache.
const token2 = await register('acc-aibb0123456789ab');
await post('/v1/entitlement/trial', { installId: 'install-ai-111111111' }, token2);
const other = await post('/v1/ai', { task: 'translate', text: 'the harpoon' }, token2);
check('another account hits the same cached entry', ((await other.json()) as AiCompleteResponse).cached === true);
check('still one upstream call across two accounts', upstreamCalls === 1);

// --- the budget is in units, not calls: a context-stuffing task costs more ---
const light = (await (await ask({ task: 'translate', text: 'anchor chain' })).json()) as AiCompleteResponse;
const heavy = (await (await ask({ task: 'exercises', text: 'A short chapter about the sea.', targets: ['sea'] })).json()) as AiCompleteResponse;
check('exercises charges 4 units where translate charges 1', heavy.ai.used === light.ai.used + 4);

// --- uncacheable tasks must actually re-ask ---
await ask({ task: 'hint', prompt: 'p', topic: 't', userAnswer: 'a' });
const hintCalls = upstreamCalls;
await ask({ task: 'hint', prompt: 'p', topic: 't', userAnswer: 'a' });
check('hint is re-asked, never replayed from cache', upstreamCalls === hintCalls + 1);

// --- upstream failure is refunded ---
const beforeFail = (await (await ask({ task: 'translate', text: 'anchor' })).json()) as AiCompleteResponse;
upstreamFails = true;
const failed = await ask({ task: 'translate', text: 'a fresh uncached sentence' });
check('upstream failure → 503', failed.status === 503);
const afterFail = (await (await ask({ task: 'translate', text: 'anchor' })).json()) as AiCompleteResponse;
upstreamFails = false;
check('failed call was refunded (used advanced by 1, not 2)', afterFail.ai.used === beforeFail.ai.used + 1);

// --- exhausted quota stops the spend ---
const row = await ent.get(ACC);
await ent.put({ ...row!, aiUsed: TRIAL_AI_REQUESTS });
const callsBefore = upstreamCalls;
const exhausted = await ask({ task: 'translate', text: 'something new entirely' });
check('exhausted quota → 429', exhausted.status === 429);
check('exhausted quota never reached the upstream', upstreamCalls === callsBefore);

console.log(failures === 0 ? '\nai API: all checks passed' : `\nai API: ${failures} FAILED`);
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = failures === 0 ? 0 : 1;
