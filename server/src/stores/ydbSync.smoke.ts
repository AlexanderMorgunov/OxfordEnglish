/**
 * Live smoke for YdbSyncStore against dayenglish-db. See ydbAuth.smoke.ts for the env recipe
 * (MSYS_NO_PATHCONV=1 + YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token)).
 */
import { randomBytes } from 'node:crypto';
import { YdbSyncStore } from './ydbSync.js';
import { driver } from '../ydb.js';
import type { Change } from '../sync.js';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) fail += 1;
};

const s = new YdbSyncStore();
const U = 'user-' + randomBytes(8).toString('hex');

const attempt: Change = { store: 'attempts', id: 'inst:a1', updatedAt: 1000, updatedBy: 'inst', payload: { exerciseId: 'e1' } };
const card3: Change = { store: 'srsCards', id: 'word:apple', updatedAt: 10, updatedBy: 'inst', payload: { front: 'apple', card: { reps: 3, last_review: 5 } } };

const p1 = await s.push(U, 0, [attempt, card3], 'batch-0001');
check('push → contiguous seqs 1,2, head=2', p1.head === 2 && p1.applied.map((e) => e.seq).join(',') === '1,2');

const replay = await s.push(U, 0, [attempt], 'batch-0001');
check('idempotent replay (same key) → memoized head=2', replay.head === 2 && replay.applied.length === 2);

const ps1 = await s.pull(U, 1);
check('pull since=1 → only seq 2', ps1.entries.length === 1 && ps1.entries[0]!.seq === 2 && ps1.head === 2);

// Higher-reps schedule wins the atomic card even arriving with an OLDER content updatedAt (F5).
const card9older: Change = { store: 'srsCards', id: 'word:apple', updatedAt: 5, updatedBy: 'other', payload: { front: 'apple', card: { reps: 9, last_review: 50 } } };
const p2 = await s.push(U, 2, [card9older], 'batch-0002');
const applePayload = p2.applied[0]?.payload as { front?: string; card?: { reps?: number } } | undefined;
check('srsCard resolution → reps 9 wins, content stays LWW', p2.applied.length === 1 && applePayload?.card?.reps === 9 && applePayload?.front === 'apple');

const p3 = await s.push(U, p2.head, [{ store: 'attempts', id: 'inst:a1', updatedAt: 9999, updatedBy: 'other', payload: { exerciseId: 'CHANGED' } }], 'batch-0003');
check('append-only re-push → no-op (immutable union)', p3.applied.length === 0 && p3.head === p2.head);

const snap = await s.pull(U, 0);
check('pull since=0 → snapshot of current state (2 rows)', snap.snapshot === true && snap.entries.length === 2);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
(await driver()).destroy();
process.exit(fail ? 1 : 0);
