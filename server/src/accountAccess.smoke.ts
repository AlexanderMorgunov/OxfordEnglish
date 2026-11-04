import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from './app.js';
import { InMemoryAuthStore } from './store.js';
import {
  InMemoryTotpStore,
  base32Decode,
  codeForStep,
  stepAt,
} from './totp.js';
import { InMemoryRecoveryNameStore } from './recoveryName.js';
import { InMemoryAccessStore } from './accessStore.js';
import { AccountAccess } from './accountAccess.js';
import { AccessSecurity } from './accessSecurity.js';
import {
  joinAtomicQueries,
  query,
  withSerializableTx,
  type Tx,
} from './ydb.js';
import {
  AccessResultSchema,
  type AccessRequest,
  type AccessResult,
} from './accessContract.js';
import type { Session } from './contract.js';
import { keyedHash } from './indexHash.js';
import { InMemoryEntitlementStore, applyPayment } from './entitlements.js';
import { InMemorySyncStore } from './sync.js';

process.env.TOTP_ENC_KEY = randomBytes(32).toString('base64');
const password = 'A private reading phrase';
const replacement = 'Another private reading phrase';
const token = () => randomBytes(32).toString('base64url');
let checks = 0;
function fixture() {
  const auth = new InMemoryAuthStore(),
    totp = new InMemoryTotpStore(),
    names = new InMemoryRecoveryNameStore();
  const access = new InMemoryAccessStore([auth, totp, names]);
  const ent = new InMemoryEntitlementStore(),
    sync = new InMemorySyncStore();
  const app = createApp(
    auth,
    sync,
    undefined,
    ent,
    undefined,
    undefined,
    totp,
    names,
    access
  );
  const security = new AccessSecurity(access, auth),
    service = new AccountAccess(security, totp, names);
  const request = (path: string, body?: unknown, session?: Session) =>
    app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const operation = (
    action: AccessRequest['action'],
    fields: Partial<AccessRequest> = {},
    session?: Session
  ) =>
    request(
      '/v1/access/operation',
      { action, operationToken: token(), ...fields },
      session
    );
  const result = async (response: Response): Promise<AccessResult> => {
    if (response.status !== 200) {
      const data = (await response.json()) as { error?: { code?: string } };
      throw new Error(
        `Expected successful local operation, status=${response.status}, code=${data.error?.code}`
      );
    }
    return AccessResultSchema.parse(await response.json());
  };
  const register = async (login = 'reader_one') =>
    (
      await result(
        await operation('register', {
          login,
          password,
          deviceId: 'fixture-device-one',
        })
      )
    ).session!;
  const reauth = async (
    session: Session,
    purpose: 'setup' | 'attach' | 'codes' | 'password',
    credential = password,
    credentialType: 'password' | 'key' = 'password'
  ) =>
    (
      await result(
        await operation(
          'reauth',
          { purpose, credential, credentialType },
          session
        )
      )
    ).proof!;
  const enroll = async (session: Session) => {
    const proof = await reauth(session, 'setup');
    const draft = await result(await operation('enroll', { proof }, session));
    const enrollment = draft.enrollment!;
    const code = codeForStep(
      base32Decode(enrollment.secret),
      stepAt(Date.now())
    );
    const confirmed = await result(
      await operation('confirm', { enrollmentId: enrollment.id, code }, session)
    );
    return { enrollment, code, confirmed };
  };
  return {
    app,
    auth,
    ent,
    sync,
    totp,
    names,
    access,
    security,
    service,
    request,
    operation,
    result,
    register,
    reauth,
    enroll,
  };
}

{
  const f = fixture();
  const outcomes = await Promise.all([
    f.operation('register', { login: 'same_reader', password }),
    f.operation('register', { login: 'SAME_READER', password }),
  ]);
  assert.ok(
    outcomes
      .map((r) => r.status)
      .sort()
      .join(',') === '200,409',
    'Concurrent aliases must have one winner'
  );
  assert.ok(
    (await f.auth.countAccounts()) === 1,
    'Losing registration must not leave an orphan'
  );
  checks++;
}
{
  const f = fixture(),
    nonce = token();
  const fields = { login: 'receipt_reader', password, operationToken: nonce };
  const first = await f.result(await f.operation('register', fields));
  const repeated = await f.result(await f.operation('register', fields));
  assert.ok(
    first.session?.refreshToken === repeated.session?.refreshToken,
    'A repeated operation must return the same session'
  );
  assert.ok(
    (await f.auth.countAccounts()) === 1,
    'Receipt replay must not create another account'
  );
  assert.ok(
    (await f.operation('register', { ...fields, login: 'other_reader' }))
      .status === 409,
    'An operation secret must bind its input'
  );
  const restored = await f.result(
    await f.request('/v1/access/receipt', { operationToken: nonce })
  );
  assert.ok(
    restored.session?.accountId === first.session?.accountId,
    'Lost reply must be reconcilable'
  );
  checks++;
}
{
  const f = fixture(),
    owner = await f.register();
  const { code, confirmed } = await f.enroll(owner);
  assert.ok(
    confirmed.codes?.length === 8,
    'Enrollment must issue eight backup codes'
  );
  assert.ok(
    (await f.operation('recover', { login: 'reader_one', code })).status ===
      401,
    'The confirmation TOTP cannot be replayed'
  );
  const backup = confirmed.codes![0]!,
    nonce = token();
  const verified = await f.result(
    await f.operation('recover', {
      login: 'reader_one',
      code: backup,
      operationToken: nonce,
    })
  );
  assert.ok(
    (await f.totp.get(owner.accountId))?.backupHashes.length === 7,
    'A backup is consumed at proof verification'
  );
  const replay = await f.result(
    await f.request('/v1/access/receipt', { operationToken: nonce })
  );
  assert.ok(
    replay.proof === verified.proof,
    'Lost proof reply must not spend another backup'
  );
  assert.ok(
    (await f.operation('recover', { login: 'reader_one', code: backup }))
      .status === 401,
    'Spent backup must not create another grant'
  );
  const link = (await (
    await f.request('/v1/auth/device/start', { deviceName: 'pending fixture' })
  ).json()) as { requestId: string; code: string };
  assert.ok(
    (await f.request('/v1/auth/device/approve', { code: link.code }, owner))
      .status === 200
  );
  const reset = await f.result(
    await f.operation('reset', { password: replacement, proof: verified.proof })
  );
  assert.ok(
    reset.accountId === owner.accountId,
    'Recovery must keep the account identity'
  );
  assert.ok(
    (await f.request('/v1/access/status', undefined, owner)).status === 401,
    'Old access JWT must be revoked immediately'
  );
  assert.ok(
    (await f.request('/v1/auth/refresh', { refreshToken: owner.refreshToken }))
      .status === 401,
    'Old refresh must be revoked'
  );
  const polled = (await (
    await f.request(`/v1/auth/device/poll?requestId=${link.requestId}`)
  ).json()) as { status: string };
  assert.ok(
    polled.status === 'expired',
    'An approval predating recovery must not mint a fresh session'
  );
  assert.ok(
    (await f.operation('login', { login: 'reader_one', password })).status ===
      401,
    'Old password must no longer work'
  );
  const signedIn = await f.result(
    await f.operation('login', {
      login: 'READER_ONE',
      password: replacement,
      deviceId: owner.deviceId,
    })
  );
  assert.ok(
    signedIn.session?.accountId === owner.accountId,
    'New credentials must open the same account'
  );
  assert.ok(
    (await f.request('/v1/access/status', undefined, signedIn.session))
      .status === 200,
    'New-generation JWT must work'
  );
  checks++;
}
{
  const f = fixture(),
    a = await f.register('reader_first'),
    b = await f.register('reader_second');
  const proof = await f.reauth(a, 'password');
  assert.ok(
    (await f.operation('change-password', { password: replacement, proof }, b))
      .status === 401,
    'A proof must not cross accounts'
  );
  const changed = await f.result(
    await f.operation('change-password', { password: replacement, proof }, a)
  );
  assert.ok(
    changed.session?.deviceId === a.deviceId,
    'Ordinary password change must retain current device'
  );
  assert.ok(
    (await f.request('/v1/access/status', undefined, changed.session))
      .status === 200,
    'Ordinary password change must return a working current session'
  );
  assert.ok(
    (await f.request('/v1/access/status', undefined, a)).status === 401,
    'Previously issued sessions must be revoked'
  );
  await f.request('/v1/auth/refresh', { refreshToken: a.refreshToken });
  await f.request('/v1/auth/refresh', { refreshToken: a.refreshToken });
  assert.equal(
    (
      await f.request('/v1/auth/refresh', {
        refreshToken: changed.session!.refreshToken,
      })
    ).status,
    200,
    'Old-token replay must not revoke the new current-device family'
  );
  checks++;
}
{
  const f = fixture(),
    session = await f.register(),
    first = await f.enroll(session);
  const proof = await f.reauth(session, 'codes'),
    operationToken = token();
  const codes = await f.result(
    await f.operation('codes', { proof, operationToken }, session)
  );
  assert.ok(codes.codes?.length === 8);
  assert.ok(
    (
      await f.operation('recover', {
        login: 'reader_one',
        code: first.confirmed.codes![0]!,
      })
    ).status === 401,
    'Replacing codes must revoke the old set'
  );
  assert.ok(
    (
      await f.request(
        '/v1/access/receipt',
        { operationToken },
        await f.register('foreign_reader')
      )
    ).status === 401,
    'Another account must not retrieve codes'
  );
  const nextProof = await f.reauth(session, 'codes');
  await f.result(await f.operation('codes', { proof: nextProof }, session));
  assert.ok(
    (await f.request('/v1/access/receipt', { operationToken }, session))
      .status === 409,
    'A superseded receipt must not present obsolete codes as current'
  );
  checks++;
}
{
  const f = fixture(),
    oldVerifier = 'fixture-only-legacy-verifier-value';
  const legacyId = 'fixture-legacy-account';
  const legacy = await f
    .result(await f.operation('login', { login: 'not_created', password }))
    .catch(() => undefined);
  assert.ok(!legacy);
  const registration = await f.request('/v1/auth/register', {
    accountId: legacyId,
    verifier: oldVerifier,
    deviceId: 'legacy-fixture-device',
  });
  assert.ok(registration.status === 200);
  const session = (await registration.json()) as Session;
  const proof = await f.reauth(session, 'attach', oldVerifier, 'key');
  const attached = await f.result(
    await f.operation(
      'attach',
      { login: 'legacy_reader', password, proof },
      session
    )
  );
  assert.ok(
    attached.accountId === legacyId,
    'Attaching login must preserve legacy identity'
  );
  assert.ok(
    (
      await f.request('/v1/auth/login', {
        accountId: legacyId,
        verifier: oldVerifier,
      })
    ).status === 200,
    'Transition key remains valid after attach'
  );
  const { confirmed } = await f.enroll(session);
  await f.names.setName(legacyId, keyedHash('name', 'old_reader'), Date.now());
  const restored = await f.result(
    await f.operation('recover', {
      login: 'old_reader',
      code: confirmed.codes![0]!,
      legacy: true,
    })
  );
  assert.ok(
    restored.login === 'legacy_reader',
    'Legacy locator must resolve existing login without renaming it'
  );
  await f.result(
    await f.operation('reset', { password: replacement, proof: restored.proof })
  );
  assert.ok(
    (
      await f.request('/v1/auth/login', {
        accountId: legacyId,
        verifier: oldVerifier,
      })
    ).status === 401,
    'Recovery must revoke the transition key'
  );
  checks++;
}
{
  const f = fixture();
  const originalPut = f.access.put.bind(f.access);
  f.access.put = async (key, value, options) => {
    if (key.startsWith('operation:'))
      throw new Error('Injected receipt write failure');
    return originalPut(key, value, options);
  };
  const failed = await f.operation('register', {
    login: 'rollback_reader',
    password,
  });
  assert.ok(failed.status === 500);
  assert.ok(
    (await f.auth.countAccounts()) === 0,
    'Receipt failure must roll back account and alias writes'
  );
  checks++;
}
{
  const calls: boolean[] = [];
  const tx: Tx = {
    exec: async (_query, _params, commit) => {
      calls.push(Boolean(commit));
      return [[]];
    },
  };
  await joinAtomicQueries(tx, async () => {
    await query('first');
    await withSerializableTx(async (inner) => {
      await inner.exec('nested', {}, true);
    });
  });
  assert.ok(
    calls.length === 2 && calls.every((commit) => !commit),
    'Nested stores must not commit an outer account operation'
  );
  checks++;
}
{
  const f = fixture();
  for (const [login, passwordValue, expected] of [
    ['bad', password, 'login_invalid'],
    ['valid_reader', 'short', 'password_short'],
    ['valid_reader', 'a'.repeat(129), 'password_long'],
    ['valid_reader', 'dayenglish123456', 'password_weak'],
  ]) {
    const response = await f.operation('register', {
      login,
      password: passwordValue,
    });
    assert.equal(
      ((await response.json()) as { error: { code: string } }).error.code,
      expected
    );
  }
  const composed = 'Private café reading phrase';
  const registered = await f.result(
    await f.operation('register', {
      login: 'unicode_reader',
      password: composed,
    })
  );
  const logged = await f.result(
    await f.operation('login', {
      login: ' UNICODE_READER ',
      password: composed.normalize('NFD'),
    })
  );
  assert.equal(
    logged.session?.accountId,
    registered.session?.accountId,
    'NFC and NFD passwords must be equivalent'
  );
  checks++;
}
{
  const f = fixture(),
    owner = await f.register();
  const { confirmed } = await f.enroll(owner);
  const results = await Promise.all([
    f.operation('recover', { login: 'reader_one', code: confirmed.codes![0] }),
    f.operation('recover', { login: 'reader_one', code: confirmed.codes![0] }),
  ]);
  assert.equal(
    results
      .map((r) => r.status)
      .sort()
      .join(','),
    '200,401',
    'Concurrent spending of one backup has one winner'
  );
  assert.equal((await f.totp.get(owner.accountId))?.backupHashes.length, 7);
  checks++;
}
{
  const f = fixture(),
    owner = await f.register(),
    proof = await f.reauth(owner, 'password');
  const now = Date.now;
  try {
    const advanced = now() + 301000;
    Date.now = () => advanced;
    assert.equal(
      (
        await f.operation(
          'change-password',
          { proof, password: replacement },
          owner
        )
      ).status,
      401,
      'Expired primary proof cannot change a password'
    );
  } finally {
    Date.now = now;
  }
  assert.equal(
    (await f.operation('login', { login: 'reader_one', password })).status,
    200,
    'Expiry must not change credentials'
  );
  checks++;
}
{
  const f = fixture(),
    owner = await f.register(),
    proof = await f.reauth(owner, 'setup');
  const draft = await f.result(await f.operation('enroll', { proof }, owner));
  assert.equal(
    (
      await f.operation(
        'cancel-enrollment',
        { enrollmentId: draft.enrollment!.id },
        owner
      )
    ).status,
    200
  );
  const code = codeForStep(
    base32Decode(draft.enrollment!.secret),
    stepAt(Date.now())
  );
  assert.equal(
    (
      await f.operation(
        'confirm',
        { enrollmentId: draft.enrollment!.id, code },
        owner
      )
    ).status,
    401,
    'Cancelled seed cannot enable recovery'
  );
  assert.equal((await f.service.status(owner.accountId)).recovery, false);
  checks++;
}
{
  const f = fixture(),
    owner = await f.register();
  const { confirmed } = await f.enroll(owner);
  const resetProof = await f.result(
    await f.operation('recover', {
      login: 'reader_one',
      code: confirmed.codes![0],
    })
  );
  const codesProof = await f.reauth(owner, 'codes');
  const next = await f.result(
    await f.operation('codes', { proof: codesProof }, owner)
  );
  assert.equal(
    (
      await f.operation('reset', {
        proof: resetProof.proof,
        password: replacement,
      })
    ).status,
    401,
    'Replacing codes invalidates outstanding recovery grants'
  );
  assert.equal(
    (
      await f.operation(
        'acknowledge',
        { codesRevision: confirmed.account!.codesRevision! },
        owner
      )
    ).status,
    409
  );
  const acknowledged = await f.result(
    await f.operation(
      'acknowledge',
      { codesRevision: next.account!.codesRevision! },
      owner
    )
  );
  assert.equal(acknowledged.account?.codesAcknowledged, true);
  checks++;
}
{
  const f = fixture(),
    owner = await f.register();
  await f.ent.put(applyPayment(null, owner.accountId, Date.now(), 30));
  await f.sync.push(
    owner.accountId,
    0,
    [
      {
        store: 'wordStatus',
        id: 'fixture-word',
        updatedAt: Date.now(),
        updatedBy: owner.deviceId,
        payload: { word: 'fiction', status: 'learning' },
      },
    ],
    'fixture-before-recovery'
  );
  const paidUntil = (await f.ent.get(owner.accountId))!.paidUntil;
  const { confirmed } = await f.enroll(owner);
  const resetProof = await f.result(
    await f.operation('recover', {
      login: 'reader_one',
      code: confirmed.codes![0],
    })
  );
  await f.result(
    await f.operation('reset', {
      proof: resetProof.proof,
      password: replacement,
    })
  );
  assert.equal(
    (await f.ent.get(owner.accountId))?.paidUntil,
    paidUntil,
    'Recovery must retain paid time'
  );
  assert.equal(
    (await f.sync.pull(owner.accountId, 0)).entries[0]?.id,
    'fixture-word',
    'Recovery must retain synced vocabulary'
  );
  const fresh = await f.result(
    await f.operation('login', {
      login: 'reader_one',
      password: replacement,
      deviceId: owner.deviceId,
    })
  );
  assert.equal(
    (await f.request('/v1/auth/refresh', { refreshToken: owner.refreshToken }))
      .status,
    401,
    'Same-device relogin must not revive an old refresh token'
  );
  assert.equal(
    (await f.request('/v1/access/status', undefined, fresh.session)).status,
    200
  );
  const erased = await f.app.request('/v1/account', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${fresh.session!.accessToken}` },
  });
  assert.equal(erased.status, 200);
  assert.equal((await f.request('/v1/auth/register', { accountId: owner.accountId, verifier: 'fixture-deleted-account-verifier' })).status, 400, 'Legacy registration cannot reclaim a server-issued password account ID');
  assert.equal(
    (await f.request('/v1/access/status', undefined, fresh.session)).status,
    401,
    'Deleted account JWT cannot work'
  );
  assert.equal(await f.access.get(`account:${owner.accountId}`), undefined);
  assert.equal(
    (
      (await f.service.availability('reader_one', 'fixture-ip')) as {
        available: boolean;
      }
    ).available,
    true,
    'Deletion releases the username index'
  );
  assert.equal(await f.totp.get(owner.accountId), null);
  checks++;
}
console.log(`accountAccess smoke: ${checks} scenarios passed`);
