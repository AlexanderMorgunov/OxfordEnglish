/**
 * In-process smoke test of the auth API via Hono's `app.request()` — exercises the real routing +
 * resolution logic without a network server (avoids env-specific @hono/node-server quirks).
 * Run: `npx tsx src/smoke.ts`. Exits non-zero on any failure.
 */
import { createApp } from './app.js';
import { InMemoryBlobStore } from './blobs.js';
import { REGISTER_MAX_PER_IP, IP_BUCKET_CAPACITY } from './contract.js';

const app = createApp();
const H = { 'content-type': 'application/json' };
let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};
const post = (path: string, body: unknown, headers: Record<string, string> = H) =>
  app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });

const ACC = 'acc-0123456789abcdef'; // ≥16 chars, like a real base64url accountId
const VER = 'verifier-0123456789abcdef';

const health = await app.request('/health');
check('health → 200 "ok"', health.status === 200 && (await health.text()) === 'ok');

const jr = await app.request('/v1/.well-known/jwks.json');
const jw = (await jr.json()) as { keys: { crv?: string; alg?: string }[] };
check('jwks → Ed25519/EdDSA public key', jr.status === 200 && jw.keys[0]?.crv === 'Ed25519' && jw.keys[0]?.alg === 'EdDSA');

const reg = await post('/v1/auth/register', { accountId: ACC, verifier: VER, deviceName: 'Test' });
const s = (await reg.json()) as { created?: boolean; accessToken: string; refreshToken: string; deviceId: string };
check('register → created session', reg.status === 200 && s.created === true && !!s.accessToken && !!s.refreshToken);

const dup = await post('/v1/auth/register', { accountId: ACC, verifier: VER });
check('duplicate register → 409', dup.status === 409);

const r2 = await post('/v1/auth/refresh', { refreshToken: s.refreshToken });
const s2 = (await r2.json()) as { refreshToken: string };
check('refresh → rotated (new refresh token)', r2.status === 200 && !!s2.refreshToken && s2.refreshToken !== s.refreshToken);

const reuse = await post('/v1/auth/refresh', { refreshToken: s.refreshToken });
const re = (await reuse.json()) as { error?: { code?: string } };
check('reuse old refresh → 401 refresh_reused', reuse.status === 401 && re.error?.code === 'refresh_reused');

const afterReuse = await post('/v1/auth/refresh', { refreshToken: s2.refreshToken });
check('family revoked after reuse → rotated token now invalid (401)', afterReuse.status === 401);

const dev = await app.request('/v1/auth/devices', { headers: { authorization: `Bearer ${s.accessToken}` } });
const dl = (await dev.json()) as { devices: { current?: boolean }[] };
check('devices (Bearer) → lists current device', dev.status === 200 && dl.devices.length >= 1 && dl.devices.some((d) => d.current));

const noauth = await app.request('/v1/auth/devices');
check('devices without auth → 401', noauth.status === 401);

const bad = await post('/v1/auth/login', { accountId: ACC, verifier: 'WRONG-verifier-xx' });
const be = (await bad.json()) as { error?: { code?: string } };
check('login wrong verifier → 401 invalid_credentials', bad.status === 401 && be.error?.code === 'invalid_credentials');

const ok = await post('/v1/auth/login', { accountId: ACC, verifier: VER });
const okj = (await ok.json()) as { accessToken: string; accountId: string; created?: boolean };
check('login correct verifier → session (not created)', ok.status === 200 && !!okj.accessToken && okj.created !== true);

// --- Device linking by approval ---
const authed = { authorization: `Bearer ${okj.accessToken}` };
const start = await post('/v1/auth/device/start', { deviceName: 'New Phone' });
const link = (await start.json()) as { requestId: string; code: string; expiresAt: number };
check('device/start → requestId + code', start.status === 200 && !!link.requestId && !!link.code);

const pollPending = await app.request(`/v1/auth/device/poll?requestId=${link.requestId}`);
check('poll before approve → pending', pollPending.status === 200 && ((await pollPending.json()) as { status?: string }).status === 'pending');

const badApprove = await post('/v1/auth/device/approve', { code: 'not-a-real-code' }, authed);
check('approve wrong code → 401', badApprove.status === 401);

const approve = await post('/v1/auth/device/approve', { code: link.code }, authed);
const ap = (await approve.json()) as { ok?: boolean; deviceName?: string };
check('approve (Bearer) → ok + shows new device name', approve.status === 200 && ap.ok === true && ap.deviceName === 'New Phone');

const pollDone = await app.request(`/v1/auth/device/poll?requestId=${link.requestId}`);
const pd = (await pollDone.json()) as { status: string; session?: { accountId: string; deviceId: string; refreshToken: string } };
check('poll after approve → approved session for the same account', pollDone.status === 200 && pd.status === 'approved' && pd.session?.accountId === ACC);

const pollTwice = await app.request(`/v1/auth/device/poll?requestId=${link.requestId}`);
check('poll is one-time → second poll expired', ((await pollTwice.json()) as { status?: string }).status === 'expired');

const devs = await app.request('/v1/auth/devices', { headers: authed });
const dl2 = (await devs.json()) as { devices: { deviceId: string }[] };
check('devices lists ≥2 after linking', devs.status === 200 && dl2.devices.length >= 2);

const newDeviceId = pd.session!.deviceId;
const rev = await post('/v1/auth/device/revoke', { deviceId: newDeviceId }, authed);
check('revoke device → ok', rev.status === 200 && ((await rev.json()) as { ok?: boolean }).ok === true);
const revRefresh = await post('/v1/auth/refresh', { refreshToken: pd.session!.refreshToken });
check('revoked device refresh → invalid', revRefresh.status === 401);

// --- Sync ---
const syncAuth = { authorization: `Bearer ${okj.accessToken}` };
type Entry = { seq: number; store: string; id: string; payload: unknown };
type Pushed = { head: number; applied: Entry[] };
type Pulled = { head: number; entries: Entry[]; snapshot?: boolean };

const noAuthPull = await app.request('/v1/sync?since=0');
check('sync pull without auth → 401', noAuthPull.status === 401);

const push1 = await post(
  '/v1/sync',
  {
    cursorSeq: 0,
    idempotencyKey: 'batch-0001',
    changes: [
      { store: 'attempts', id: 'inst:a1', updatedAt: 1000, updatedBy: 'inst', payload: { exerciseId: 'e1' } },
      { store: 'srsCards', id: 'word:apple', updatedAt: 10, updatedBy: 'inst', payload: { front: 'apple', card: { reps: 3, last_review: 5 } } },
    ],
  },
  syncAuth
);
const p1 = (await push1.json()) as Pushed;
check('push → contiguous seqs from 1, head=2', push1.status === 200 && p1.head === 2 && p1.applied.map((e) => e.seq).join(',') === '1,2');

const replay = await post(
  '/v1/sync',
  { cursorSeq: 0, idempotencyKey: 'batch-0001', changes: [{ store: 'attempts', id: 'inst:a1', updatedAt: 1000, updatedBy: 'inst', payload: { exerciseId: 'e1' } }] },
  syncAuth
);
check('push replay (same idempotencyKey) → memoized, no new seqs', ((await replay.json()) as Pushed).head === 2);

const pullSince1 = await app.request('/v1/sync?since=1', { headers: syncAuth });
const ps1 = (await pullSince1.json()) as Pulled;
check('pull since=1 → only seq 2', ps1.entries.length === 1 && ps1.entries[0]!.seq === 2 && ps1.head === 2);

// srsCards resolution: a higher-reps schedule from another device must win the card even if it arrives
// with an OLDER content updatedAt (atomic card, F5).
const push2 = await post(
  '/v1/sync',
  {
    cursorSeq: 2,
    idempotencyKey: 'batch-0002',
    changes: [{ store: 'srsCards', id: 'word:apple', updatedAt: 5, updatedBy: 'other', payload: { front: 'apple', card: { reps: 9, last_review: 50 } } }],
  },
  syncAuth
);
const p2 = (await push2.json()) as Pushed;
const applePayload = p2.applied.find((e) => e.id === 'word:apple')?.payload as { front?: string; card?: { reps?: number } } | undefined;
check('srsCard resolution → higher-reps card wins (reps 9), content stays LWW', p2.applied.length === 1 && applePayload?.card?.reps === 9 && applePayload?.front === 'apple');

// Append-only idempotency: re-pushing the same attempt id changes nothing.
const push3 = await post(
  '/v1/sync',
  { cursorSeq: p2.head, idempotencyKey: 'batch-0003', changes: [{ store: 'attempts', id: 'inst:a1', updatedAt: 9999, updatedBy: 'other', payload: { exerciseId: 'CHANGED' } }] },
  syncAuth
);
check('append-only attempt re-push → no-op (immutable union)', ((await push3.json()) as Pushed).applied.length === 0);

const snap = await app.request('/v1/sync?since=0', { headers: syncAuth });
const sp = (await snap.json()) as Pulled;
check('pull since=0 → snapshot of current state (2 rows: attempt + card)', sp.snapshot === true && sp.entries.length === 2);

// --- Book file blobs ---
const put = (path: string, bytes: Uint8Array) => app.request(path, { method: 'PUT', headers: syncAuth, body: bytes });

const noAuthBlobs = await app.request('/v1/blobs');
check('blobs list without auth → 401', noAuthBlobs.status === 401);

const tooBig = await post('/v1/blobs/upload-url', { bookId: 'bk1', size: 21 * 1024 * 1024 }, syncAuth);
check('upload-url over per-book cap → 413 blob_too_large', tooBig.status === 413);

const up = await post('/v1/blobs/upload-url', { bookId: 'bk1', size: 5 }, syncAuth);
const target = (await up.json()) as { url: string; key: string };
check('upload-url → target with key', up.status === 200 && !!target.url && !!target.key);

const bytes = new Uint8Array([1, 2, 3, 4, 5]);
const dataPut = await put(target.url, bytes);
check('PUT bytes to the dev upload target → 204', dataPut.status === 204);

const mismatch = await post('/v1/blobs/commit', { bookId: 'bk1', key: target.key, size: 999 }, syncAuth);
check('commit wrong size → 409 size_mismatch', mismatch.status === 409);

const commit = await post('/v1/blobs/commit', { bookId: 'bk1', key: target.key, size: 5 }, syncAuth);
const meta = (await commit.json()) as { bookId: string; size: number };
check('commit correct size → blob meta', commit.status === 200 && meta.bookId === 'bk1' && meta.size === 5);

const listBlobs = await app.request('/v1/blobs', { headers: syncAuth });
const bl = (await listBlobs.json()) as { blobs: unknown[]; usedBytes: number };
check('blobs list → 1 blob, usedBytes = 5', bl.blobs.length === 1 && bl.usedBytes === 5);

const dlUrl = await app.request('/v1/blobs/bk1/download-url', { headers: syncAuth });
const dlt = (await dlUrl.json()) as { url: string };
const got = await app.request(dlt.url, { headers: syncAuth });
const gotBytes = new Uint8Array(await got.arrayBuffer());
check('download-url → same 5 bytes back', got.status === 200 && gotBytes.length === 5 && gotBytes[0] === 1);

const foreign = await app.request(`/v1/blobs/data/${encodeURIComponent('someone-else/bk1')}`, { headers: syncAuth });
check("cannot read another user's key prefix → 403", foreign.status === 403);

const del = await app.request('/v1/blobs/bk1', { method: 'DELETE', headers: syncAuth });
check('delete blob → ok', del.status === 200);
const afterDel = await app.request('/v1/blobs', { headers: syncAuth });
check('after delete → usage back to 0', ((await afterDel.json()) as { usedBytes: number }).usedBytes === 0);

// gcOrphans is the seam for a future server-side maintenance cron (not a client route — a client's
// partial view could delete a blob another device references). Unit-check it directly here.
const gcStore = new InMemoryBlobStore();
await gcStore.putObject(gcStore.objectKey('u', 'keep'), new Uint8Array([1]));
await gcStore.commit('u', 'keep', 1);
await gcStore.putObject(gcStore.objectKey('u', 'orphan'), new Uint8Array([2]));
await gcStore.commit('u', 'orphan', 1);
const removed = await gcStore.gcOrphans('u', ['keep']); // 'orphan' is no longer a live book
check('gcOrphans removes only blobs whose book is gone', removed === 1 && (await gcStore.list('u')).length === 1);

// --- Rate limiting (abuse throttles) ---
// Distinct X-Forwarded-For per sub-test isolates these buckets from the main flow (which sends no XFF).
const xff = (ip: string) => ({ ...H, 'x-forwarded-for': ip });

let regBlocked = false;
for (let i = 0; i <= REGISTER_MAX_PER_IP; i++) {
  const r = await post('/v1/auth/register', { accountId: `flood${i}-0123456789abcdef`, verifier: VER }, xff('203.0.113.7'));
  if (i === REGISTER_MAX_PER_IP) regBlocked = r.status === 429;
}
check(`register flood → attempt ${REGISTER_MAX_PER_IP + 1} from one IP is 429`, regBlocked);

const freshIp = await post('/v1/auth/register', { accountId: 'freship-0123456789abcdef', verifier: VER }, xff('203.0.113.99'));
check('register from a different IP → not limited (200)', freshIp.status === 200);

let loginBlocked = false;
let loginBefore = true;
for (let i = 0; i <= IP_BUCKET_CAPACITY; i++) {
  const r = await post('/v1/auth/login', { accountId: ACC, verifier: 'WRONG-verifier-xx' }, xff('203.0.113.8'));
  if (i < IP_BUCKET_CAPACITY && r.status === 429) loginBefore = false; // must not trip early
  if (i === IP_BUCKET_CAPACITY) loginBlocked = r.status === 429;
}
check(`login bucket → first ${IP_BUCKET_CAPACITY} pass, next is 429`, loginBefore && loginBlocked);

// --- Delete account (152-ФЗ) ---
const delAcc = await app.request('/v1/account', { method: 'DELETE', headers: syncAuth });
check('delete account → ok', delAcc.status === 200);
const loginGone = await post('/v1/auth/login', { accountId: ACC, verifier: VER });
check('login after delete → 401 (account purged)', loginGone.status === 401);
const syncGone = await app.request('/v1/sync?since=0', { headers: syncAuth });
check('sync after delete → empty snapshot', ((await syncGone.json()) as { entries: unknown[] }).entries.length === 0);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
