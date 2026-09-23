/**
 * In-process smoke for the owner-only admin surface. Run: `npx tsx src/admin.smoke.ts`.
 *
 * The property that matters most is the first one: with no `ADMIN_TOKEN` the routes do not exist at all.
 * Production sets no such variable, so a mistake in the auth check cannot expose what was never mounted
 * — but only if the mounting really is conditional, which is what this asserts.
 */
import { createApp } from './app.js';
import { InMemoryAuthStore } from './store.js';
import { InMemoryEntitlementStore, applyPayment, TRIAL_MS, type Entitlement } from './entitlements.js';
import { computeStats } from './adminStats.js';
import { ADMIN_TOKEN_MIN } from './routes/admin.js';
import { IP_BUCKET_CAPACITY } from './contract.js';

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

const TOKEN = 'a'.repeat(ADMIN_TOKEN_MIN);
const H = (t: string) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

async function appWith(token: string | undefined, seed?: (a: InMemoryAuthStore, e: InMemoryEntitlementStore) => Promise<void>) {
  if (token === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = token;
  const auth = new InMemoryAuthStore();
  const ent = new InMemoryEntitlementStore();
  if (seed) await seed(auth, ent);
  return { app: createApp(auth, undefined, undefined, ent), auth, ent };
}

// --- gate 1: the surface does not exist without a token -------------------------------------------
{
  const { app } = await appWith(undefined);
  const stats = await app.request('/v1/admin/stats', { headers: H(TOKEN) });
  const page = await app.request('/admin');
  check('no ADMIN_TOKEN → stats 404 (never mounted)', stats.status === 404);
  check('no ADMIN_TOKEN → no admin page', page.status === 404);
}

{
  const { app } = await appWith('short');
  const stats = await app.request('/v1/admin/stats', { headers: H('short') });
  check('a too-short ADMIN_TOKEN mounts nothing rather than warning and carrying on', stats.status === 404);
}

// --- gate 2: the token is actually checked --------------------------------------------------------
{
  const { app } = await appWith(TOKEN);
  const none = await app.request('/v1/admin/stats');
  const wrong = await app.request('/v1/admin/stats', { headers: H('b'.repeat(ADMIN_TOKEN_MIN)) });
  // Different LENGTH is the case that matters: `timingSafeEqual` throws on unequal buffers, so a naive
  // check answers through a 500 instead of a 401 — and the difference is observable.
  const shorter = await app.request('/v1/admin/stats', { headers: H('c') });
  const right = await app.request('/v1/admin/stats', { headers: H(TOKEN) });
  check('no header → 401', none.status === 401);
  check('wrong token → 401', wrong.status === 401);
  check('token of a different length → 401, not a crash', shorter.status === 401);
  check('right token → 200', right.status === 200);
}

// --- the page is served by THIS process, not shipped to users -------------------------------------
{
  const { app } = await appWith(TOKEN);
  const res = await app.request('/admin');
  const html = await res.text();
  check('the admin page is served when the token is set', res.status === 200);
  check('it is html', (res.headers.get('content-type') ?? '').includes('text/html'));
  check('it carries the token field, the counts and the grant form', /id="tok"/.test(html) && /id="stats"/.test(html) && /id="grant"/.test(html));
  check('it talks to the admin endpoints', html.includes('/v1/admin/stats') && html.includes('/v1/admin/grant'));
  // sessionStorage, not localStorage: an owner token outliving a closed tab on a shared machine is the
  // thing this whole surface is meant to make harder.
  check('it keeps the token in sessionStorage only', html.includes('sessionStorage.') && !html.includes('localStorage.'));
  check('it embeds no token of its own', !html.includes(TOKEN));
}

// --- the counts say what they claim ---------------------------------------------------------------
{
  const now = Date.now();
  const { app } = await appWith(TOKEN, async (auth, ent) => {
    await auth.createAccount('acc-free', 'h');
    await auth.createAccount('acc-trial', 'h');
    await auth.createAccount('acc-trial-over', 'h');
    await auth.createAccount('acc-paid', 'h');
    await auth.createAccount('acc-lapsed', 'h');
    await ent.put({ accountId: 'acc-trial', trialStartedAt: now - 1000, aiUsed: 0, windowStartedAt: now });
    await ent.put({ accountId: 'acc-trial-over', trialStartedAt: now - TRIAL_MS - 1000, aiUsed: 0, windowStartedAt: now });
    await ent.put(applyPayment(null, 'acc-paid', now, 30));
    await ent.put({ accountId: 'acc-lapsed', paidUntil: now - 1000, aiUsed: 0, windowStartedAt: now });
  });
  const s = (await (await app.request('/v1/admin/stats', { headers: H(TOKEN) })).json()) as Record<string, number>;
  check('accounts counts every account, not only the ones with an entitlement row', s.accounts === 5);
  check('trialsStarted counts expired trials too', s.trialsStarted === 2);
  check('trialsActive counts only the running one', s.trialsActive === 1);
  check('paidEver counts the lapsed subscription', s.paidEver === 2);
  check('paidActive does not', s.paidActive === 1);
}

// --- grant ----------------------------------------------------------------------------------------
{
  const { app, ent } = await appWith(TOKEN, async (auth) => {
    await auth.createAccount('acc-1', 'h');
  });
  const post = (body: unknown) => app.request('/v1/admin/grant', { method: 'POST', headers: H(TOKEN), body: JSON.stringify(body) });

  const granted = await post({ accountId: 'acc-1', days: 30 });
  const first = (await granted.json()) as { entitlement: Entitlement };
  check('granting makes the account pro', granted.status === 200 && first.entitlement.plan === 'pro');

  const again = await post({ accountId: 'acc-1', days: 30 });
  const second = (await again.json()) as { entitlement: Entitlement };
  // Extends rather than replaces — the same rule a renewal follows. Getting this wrong would silently
  // shorten a plan instead of lengthening it.
  check(
    'a second grant extends the first',
    (second.entitlement.paidUntil ?? 0) - (first.entitlement.paidUntil ?? 0) > 29 * 86_400_000
  );

  const unknown = await post({ accountId: 'acc-nope', days: 30 });
  check('an id that belongs to no account is refused', unknown.status === 404);
  check('and writes no orphan entitlement row', (await ent.get('acc-nope')) === null);

  check('zero days is refused', (await post({ accountId: 'acc-1', days: 0 })).status === 400);
  check('a century is refused', (await post({ accountId: 'acc-1', days: 4000 })).status === 400);
  check('a missing id is refused', (await post({ days: 30 })).status === 400);
  check('a non-numeric day count is refused', (await post({ accountId: 'acc-1', days: 'lots' })).status === 400);
}

// --- a grant must not trample a concurrent write ---------------------------------------------------
{
  const now = Date.now();
  // Asserted as write DISCIPLINE rather than by racing: an in-memory store resolves in microtasks, so
  // an interleaving test lands wherever the event loop happens to put it and passes either way. The
  // store's own contract is the thing to hold the route to — "a plain get→put is not good enough for
  // spending money", because the read copies a whole row and the write puts all of it back, erasing
  // whatever landed in between (an AI charge, another grant).
  class Watched extends InMemoryEntitlementStore {
    puts = 0;
    mutates = 0;
    override async put(row: Parameters<InMemoryEntitlementStore['put']>[0]) {
      this.puts += 1;
      return super.put(row);
    }
    override async mutate<T>(id: string, decide: Parameters<InMemoryEntitlementStore['mutate']>[1]) {
      this.mutates += 1;
      return super.mutate(id, decide) as Promise<T>;
    }
  }
  process.env.ADMIN_TOKEN = TOKEN;
  const auth = new InMemoryAuthStore();
  await auth.createAccount('acc-1', 'h');
  const watched = new Watched();
  const app = createApp(auth, undefined, undefined, watched);
  watched.puts = 0;

  await app.request('/v1/admin/grant', { method: 'POST', headers: H(TOKEN), body: JSON.stringify({ accountId: 'acc-1', days: 30 }) });

  check('the grant goes through the serialized path', watched.mutates === 1);
  check('and never writes the whole row back on its own', watched.puts === 0);
  check('the days still landed', ((await watched.get('acc-1'))?.paidUntil ?? 0) > now);
}

// --- lookup ---------------------------------------------------------------------------------------
{
  const { app } = await appWith(TOKEN, async (auth, ent) => {
    await auth.createAccount('acc-1', 'h');
    await ent.put(applyPayment(null, 'acc-1', Date.now(), 7));
  });
  const found = await app.request('/v1/admin/accounts/acc-1', { headers: H(TOKEN) });
  const missing = await app.request('/v1/admin/accounts/acc-nope', { headers: H(TOKEN) });
  check('a known account reads back its plan', found.status === 200 && ((await found.json()) as { entitlement: Entitlement }).entitlement.plan === 'pro');
  check('an unknown one is a 404, not an empty plan', missing.status === 404);
}

// --- the shared counter, directly -----------------------------------------------------------------
{
  const now = Date.now();
  const empty = computeStats(0, [], now);
  check('no rows is all zeroes rather than NaN', empty.accounts === 0 && empty.trialsStarted === 0 && empty.paidActive === 0);
  // Paid beats trial in `planOf`, so someone who bought during their trial counts once as pro — not
  // once in each column. A second copy of that rule in YQL is exactly what this shared path avoids.
  const both = computeStats(1, [{ trialStartedAt: now - 1000, paidUntil: now + 1000 }], now);
  check('a trial that turned into a purchase counts as pro, not as both', both.trialsActive === 0 && both.paidActive === 1);
  check('and its trial is still counted as started', both.trialsStarted === 1);
}

// --- guessing the token is throttled ---------------------------------------------------------------
{
  const { app } = await appWith(TOKEN);
  const wrong = () => app.request('/v1/admin/stats', { headers: H('b'.repeat(ADMIN_TOKEN_MIN)) });
  let allRejected = true;
  for (let i = 0; i < IP_BUCKET_CAPACITY; i++) if ((await wrong()).status !== 401) allRejected = false;
  const exhausted = await wrong();
  check(`the first ${IP_BUCKET_CAPACITY} guesses are answered 401, not 429`, allRejected);
  // The limiter has to sit IN FRONT of the token check. Behind it a wrong guess never reaches it and
  // the only thing throttled is the owner — the exact inverse of the point.
  check('a flood of wrong tokens is cut off with 429', exhausted.status === 429);
  // The right token is cut off too: the bucket is per IP, not per credential, so a flood locks the
  // owner out as well. That is the trade — the alternative spends a store read per guess — but it is a
  // property rather than an accident, so it is asserted instead of assumed.
  check('and the right token is refused while the bucket is empty', (await app.request('/v1/admin/stats', { headers: H(TOKEN) })).status === 429);
}

{
  // Its own bucket map. Sharing one with the public endpoints would let anyone knocking on /admin take
  // sign-in down with it, and let ordinary sign-in traffic lock the owner out of granting a plan.
  const { app } = await appWith(TOKEN, async (auth) => {
    await auth.createAccount('acc-1', 'h');
  });
  for (let i = 0; i <= IP_BUCKET_CAPACITY; i++) await app.request('/v1/admin/stats', { headers: H('b'.repeat(ADMIN_TOKEN_MIN)) });
  const login = await app.request('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId: 'acc-1', verifier: 'nope', deviceId: 'd1' }),
  });
  check('an exhausted admin bucket does not throttle sign-in', login.status !== 429);
}

delete process.env.ADMIN_TOKEN;
console.log(failures ? `\nadmin: ${failures} FAILED` : '\nadmin: all checks passed');
process.exit(failures ? 1 : 0);
