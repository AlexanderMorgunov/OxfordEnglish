/**
 * In-process smoke test of the auth API via Hono's `app.request()` — exercises the real routing +
 * resolution logic without a network server (avoids env-specific @hono/node-server quirks).
 * Run: `npx tsx src/smoke.ts`. Exits non-zero on any failure.
 */
import { createApp } from './app.js';

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

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
