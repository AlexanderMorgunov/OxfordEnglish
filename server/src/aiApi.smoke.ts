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

const post = (path: string, body: unknown, token?: string, ip?: string) =>
  app.request(path, {
    method: 'POST',
    headers: {
      ...H,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      // Every in-process request otherwise shares one client address, so the route's per-IP burst
      // limiter would count all of this file's calls against a single bucket. A test that needs real
      // concurrency presents its own address, exactly as a separate user would.
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
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
const huge = await ask({ task: 'exercises', text: 'x'.repeat(9000), targets: ['x'] });
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


// --- the charge must be atomic, or concurrency is a discount ---
// Before the store's `mutate`, a get→put pair let N concurrent calls all read the same `aiUsed`, all
// pass the limit check, and all write the same result: N calls charged once, with us paying the
// upstream for every one of them.
// Balances are read from the store, and successes are counted rather than assumed: the route now also
// carries a per-IP burst limiter, and every in-process request here shares one client address, so some
// of a burst is expected to be turned away. What must hold is that each call that GOT THROUGH is charged
// exactly once.
{
  const RACE = 'acc-race0123456789ab';
  const raceToken = await register(RACE);
  await post('/v1/entitlement/trial', { installId: 'install-race-00000000' }, raceToken);
  const before = (await ent.get(RACE))!.aiUsed;

  const statuses = await Promise.all(
    Array.from({ length: 12 }, async (_, i) => (await post('/v1/ai', { task: 'translate', text: `race ${i}` }, raceToken, '203.0.113.9')).status)
  );
  const served = statuses.filter((s) => s === 200).length;
  check('the burst was actually concurrent (more than one call served)', served > 1);
  check('every served call is charged exactly once (no lost updates)', (await ent.get(RACE))!.aiUsed === before + served);
}

// A burst that straddles the cap must stop AT the cap, not sail past it.
{
  const CAP = 'acc-cap00123456789ab';
  const capToken = await register(CAP);
  await post('/v1/entitlement/trial', { installId: 'install-cap-000000000' }, capToken);
  const row = await ent.get(CAP);
  await ent.put({ ...row!, aiUsed: TRIAL_AI_REQUESTS - 5 }); // room for at most 5 single-unit calls

  const results = await Promise.all(
    Array.from({ length: 15 }, async (_, i) => (await post('/v1/ai', { task: 'translate', text: `cap ${i}` }, capToken, '203.0.113.10')).status)
  );
  const served = results.filter((s) => s === 200).length;
  check('a burst over the cap never serves more than the remaining budget', served <= 5);
  check('...and the balance lands exactly on what was served', (await ent.get(CAP))!.aiUsed === TRIAL_AI_REQUESTS - 5 + served);
  check('the balance never exceeds the limit', (await ent.get(CAP))!.aiUsed <= TRIAL_AI_REQUESTS);
}

console.log(failures === 0 ? '\nai API: all checks passed' : `\nai API: ${failures} FAILED`);
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = failures === 0 ? 0 : 1;
