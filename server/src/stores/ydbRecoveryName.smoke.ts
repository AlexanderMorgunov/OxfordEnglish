/**
 * Live smoke for YdbRecoveryNameStore against dayenglish-db. See ydbAuth.smoke.ts for the env recipe
 * (MSYS_NO_PATHCONV=1 + YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token)).
 *
 * What the in-memory smoke structurally CANNOT check, and why this file exists: the in-memory store is a
 * `Map` keyed by account, so setting a second name replaces the first for free. The real table is keyed
 * by (name_hash, account_id), where the same write INSERTS — leaving the account findable under every
 * name it has ever used, including one abandoned precisely because someone else knew it. That divergence
 * passes every in-process test.
 *
 * Hashes are opaque to the store, so this uses literals and needs no INDEX_HMAC_KEY.
 */
import { randomBytes } from 'node:crypto';
import { YdbRecoveryNameStore } from './ydbRecoveryName.js';
import { NAME_CANDIDATE_CAP } from '../recoveryName.js';
import { driver } from '../ydb.js';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail += 1;
};

const s = new YdbRecoveryNameStore();
const tag = randomBytes(6).toString('hex');
const ACC = `acc-name-${tag}`;
const OTHER = `acc-other-${tag}`;
const H1 = `v2:smoke1-${tag}`;
const H2 = `v2:smoke2-${tag}`;
const NOW = Date.now();

const planted: string[] = [];

check('an account with no name has none', !(await s.hasName(ACC)));
check('an unused name resolves to nobody', (await s.candidates(H1)).length === 0);

check('setting a name succeeds', (await s.setName(ACC, H1, NOW)) === 'ok');
planted.push(ACC);
check('the name finds the account', (await s.candidates(H1)).includes(ACC));
check('hasName sees it', await s.hasName(ACC));

check('setting the SAME name again is a no-op', (await s.setName(ACC, H1, NOW)) === 'ok');
check('...and does not double the row', (await s.candidates(H1)).length === 1);

// The one this file exists for.
check('changing the name succeeds', (await s.setName(ACC, H2, NOW)) === 'ok');
check('the new name finds the account', (await s.candidates(H2)).includes(ACC));
check('the OLD name no longer does', (await s.candidates(H1)).length === 0);

await s.setName(OTHER, H2, NOW);
planted.push(OTHER);
const shared = await s.candidates(H2);
check('two accounts may share a name', shared.length === 2 && shared.includes(ACC) && shared.includes(OTHER));

// --- the attempt counter ---
const HN = `v2:attempts-${tag}`;
check('a name with no history reads as null', (await s.bumpAttempts(HN, (a) => ({ result: a }))) === null);
await s.bumpAttempts(HN, () => ({ row: { nameHash: HN, failCount: 7, failWindowStart: NOW }, result: undefined }));
const back = await s.bumpAttempts(HN, (a) => ({ result: a }));
check('the count round-trips', back?.failCount === 7);
// Milliseconds, not seconds: a window start read back at 1/1000 of its value would put every row far
// outside the window and disable the throttle entirely.
check('the window start round-trips to the same ms', back?.failWindowStart === NOW);
await s.bumpAttempts(HN, (a) => ({ row: { nameHash: HN, failCount: (a?.failCount ?? 0) + 3, failWindowStart: NOW }, result: undefined }));
check('a second write accumulates', (await s.bumpAttempts(HN, (a) => ({ result: a })))?.failCount === 10);

// --- the cap is enforced against the real table ---
const HC = `v2:crowd-${tag}`;
for (let i = 0; i < NAME_CANDIDATE_CAP; i += 1) {
  const id = `acc-crowd-${tag}-${i}`;
  await s.setName(id, HC, NOW);
  planted.push(id);
}
check(`${NAME_CANDIDATE_CAP} holders are all findable`, (await s.candidates(HC)).length === NAME_CANDIDATE_CAP);
const overflow = `acc-crowd-${tag}-over`;
check('one more is refused', (await s.setName(overflow, HC, NOW)) === 'crowded');
check('...and really was not written', !(await s.hasName(overflow)));

// --- removal ---
await s.clearName(ACC);
check('clearName removes the row', !(await s.hasName(ACC)));
check('...and the name stops resolving to it', !(await s.candidates(H2)).includes(ACC));
await s.purge(OTHER);
check('purge removes the row', !(await s.hasName(OTHER)));
// The counter is keyed by NAME and shared with everyone else who chose it, so erasing one account must
// not reset it for the rest.
check('purge leaves the shared attempt counter alone', (await s.bumpAttempts(HN, (a) => ({ result: a })))?.failCount === 10);

for (const id of planted) await s.clearName(id);
check('cleanup leaves nothing behind', (await s.candidates(HC)).length === 0 && (await s.candidates(H2)).length === 0);
// The attempts row has a TTL, so it clears itself; deleting it here would hide a broken TTL.

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = fail ? 1 : 0;
