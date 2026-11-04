import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type {
  AccessRequest,
  AccessResult,
  AccessPurpose,
  AccessAccount as AccountStatus,
} from './accessContract.js';
import {
  normalizeLogin,
  normalizePassword,
  passwordPolicyError,
  validLogin,
} from './accessPolicy.js';
import {
  accessEncryptionReady,
  openAccess,
  sealAccess,
} from './accessCrypto.js';
import { AccessSecurity } from './accessSecurity.js';
import type { AccessClaims } from './tokens.js';
import { hashVerifier, verifyVerifier } from './password.js';
import { keyedHash, indexKeyConfigured } from './indexHash.js';
import { commonPasswordHashes } from './commonPasswords.js';
import type { TotpStore, TotpRow } from './totp.js';
import {
  base32Encode,
  generateSecret,
  generateBackupCodes,
  hashBackupCode,
  openSecret,
  sealSecret,
  otpauthUri,
  verifyCode,
  verifyAttempt,
  verifyUncounted,
} from './totp.js';
import type { RecoveryNameStore } from './recoveryName.js';
import { nameHash, normalizeName } from './recoveryName.js';

type FailureStatus = 400 | 401 | 404 | 409 | 429 | 503;
type AccessFailure = { error: string; status: FailureStatus };
export type AccessOutcome = { result: AccessResult } | AccessFailure;
const reject = (error: string, status: FailureStatus = 400): AccessFailure => ({
  error,
  status,
});
const accept = (result: AccessResult): AccessOutcome => ({ result });
const secret = () => randomBytes(32).toString('base64url');
const TTL = 5 * 60_000;
const WINDOW = 15 * 60_000;
type Rate = { count: number; until: number };
type Proof = {
  accountId: string;
  generation: number;
  revision: number;
  purpose: AccessPurpose | 'reset';
  deviceId?: string;
  expiresAt: number;
  used: boolean;
};
type Receipt = {
  fingerprint: string;
  accountId: string;
  generation: number;
  private: boolean;
  expiresAt: number;
  sealed: string;
};
type Enrollment = {
  accountId: string;
  generation: number;
  revision: number;
  deviceId: string;
  secretEnc: string;
  expiresAt: number;
  used: boolean;
};
const publicActions = new Set(['register', 'login', 'recover', 'reset']);
let dummyHash: Promise<string> | undefined;

export class AccountAccess {
  constructor(
    readonly security: AccessSecurity,
    readonly totp: TotpStore,
    readonly names: RecoveryNameStore
  ) {}
  async enabled(): Promise<boolean> {
    return (
      accessEncryptionReady() &&
      indexKeyConfigured() &&
      (await this.security.rows.available())
    );
  }
  private key(domain: string, value: string): string {
    return keyedHash(`access-${domain}`, value);
  }
  private sealingKey(): Buffer {
    return Buffer.from(process.env.TOTP_ENC_KEY ?? '', 'base64');
  }
  private async rate(
    domain: string,
    value: string,
    max: number,
    weight = 1
  ): Promise<boolean> {
    const key = `rate:${this.key(domain, value)}`,
      now = Date.now();
    const previous = await this.security.rows.get<Rate>(key);
    const row =
      previous && previous.until > now
        ? previous
        : { count: 0, until: now + WINDOW };
    if (row.count >= max) return false;
    await this.security.rows.put(
      key,
      { ...row, count: row.count + weight },
      { expiresAt: row.until }
    );
    return true;
  }
  async availability(
    login: string,
    ip: string
  ): Promise<{ login: string; available: boolean } | AccessFailure> {
    return this.security.rows.atomic(async () => {
      const value = normalizeLogin(login);
      if (!(await this.rate('availability-ip', ip, 60)))
        return reject('rate_limited', 429);
      return {
        login: value,
        available: validLogin(value) && !(await this.lookup(value)),
      };
    });
  }
  private lookup(login: string): Promise<string | undefined> {
    return this.security.rows.get<string>(
      `login:${this.key('login', normalizeLogin(login))}`
    );
  }
  async status(accountId: string): Promise<AccountStatus> {
    const account = await this.security.account(accountId),
      row = await this.totp.get(accountId);
    return {
      login: account.login ?? null,
      legacyKey: !account.legacyDisabled,
      recovery: Boolean(row?.confirmedAt),
      backupRemaining: row?.confirmedAt ? row.backupHashes.length : 0,
      backupTotal: row?.confirmedAt
        ? Math.max(account.codesTotal ?? 10, row.backupHashes.length)
        : 0,
      codesAcknowledged: account.codesAcknowledged ?? true,
      codesRevision: account.codesRevision ?? null,
    };
  }
  private async proof(
    accountId: string,
    purpose: Proof['purpose'],
    deviceId?: string
  ): Promise<{ proof: string; expiresAt: number }> {
    const token = secret(),
      expiresAt = Date.now() + TTL;
    const state = await this.security.account(accountId);
    await this.security.rows.put(
      `proof:${this.key('proof', token)}`,
      {
        accountId,
        generation: state.generation,
        revision: state.proofRevision ?? 0,
        deviceId,
        purpose,
        expiresAt,
        used: false,
      } satisfies Proof,
      { accountId, expiresAt }
    );
    return { proof: token, expiresAt };
  }
  private async consumeProof(
    token: string | undefined,
    purpose: Proof['purpose'],
    claims?: AccessClaims | null,
    consume = true
  ): Promise<Proof | undefined> {
    if (!token) return;
    const key = `proof:${this.key('proof', token)}`,
      proof = await this.security.rows.get<Proof>(key);
    if (
      !proof ||
      proof.used ||
      proof.purpose !== purpose ||
      proof.expiresAt <= Date.now()
    )
      return;
    if (
      proof.deviceId &&
      (!claims ||
        claims.sub !== proof.accountId ||
        claims.deviceId !== proof.deviceId)
    )
      return;
    const account = await this.security.account(proof.accountId);
    if (
      account.deleted ||
      account.generation !== proof.generation ||
      (account.proofRevision ?? 0) !== proof.revision ||
      !(await this.security.auth.getAccount(proof.accountId))
    )
      return;
    if (consume)
      await this.security.rows.put(
        key,
        { ...proof, used: true },
        { accountId: proof.accountId, expiresAt: proof.expiresAt }
      );
    return proof;
  }
  async receipt(
    token: string,
    claims: AccessClaims | null
  ): Promise<AccessOutcome> {
    const key = `operation:${this.key('operation', token)}`;
    const receipt = await this.security.rows.get<Receipt>(key);
    if (!receipt || receipt.expiresAt <= Date.now())
      return reject('operation_unknown', 404);
    if (receipt.private && claims?.sub !== receipt.accountId)
      return reject('unauthorized', 401);
    const account = await this.security.account(receipt.accountId);
    if (
      account.deleted ||
      account.generation !== receipt.generation ||
      !(await this.security.auth.getAccount(receipt.accountId))
    )
      return reject('operation_expired', 409);
    const result = openAccess<AccessResult>(receipt.sealed, key);
    if (result.codes && result.account?.codesRevision !== account.codesRevision)
      return reject('operation_superseded', 409);
    return accept(result);
  }
  async operation(
    req: AccessRequest,
    claims: AccessClaims | null,
    ip: string
  ): Promise<AccessOutcome> {
    if (!(await this.enabled())) return reject('access_unavailable', 503);
    return this.security.rows.atomic(async () => {
      const key = `operation:${this.key('operation', req.operationToken)}`;
      const fingerprint = this.key(
        'request',
        JSON.stringify({
          ...req,
          password:
            req.password == null ? undefined : normalizePassword(req.password),
          owner: publicActions.has(req.action) ? null : claims?.sub,
        })
      );
      const previous = await this.security.rows.get<Receipt>(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          return reject('operation_conflict', 409);
        return this.receipt(req.operationToken, claims);
      }
      if (!publicActions.has(req.action) && !claims)
        return reject('unauthorized', 401);
      if (
        claims &&
        !publicActions.has(req.action) &&
        !(await this.security.validAccess(claims))
      )
        return reject('unauthorized', 401);
      if (!(await this.rate('operation-ip', ip, 90)))
        return reject('rate_limited', 429);
      const outcome = await this.perform(req, claims, ip);
      if ('error' in outcome) return outcome;
      const accountId =
        outcome.result.accountId ??
        outcome.result.session?.accountId ??
        claims?.sub;
      if (!accountId) throw new Error('Account operation has no owner');
      const state = await this.security.account(accountId),
        expiresAt = Date.now() + TTL;
      await this.security.rows.put(
        key,
        {
          fingerprint,
          accountId,
          generation: state.generation,
          private: !publicActions.has(req.action),
          expiresAt,
          sealed: sealAccess(outcome.result, key),
        } satisfies Receipt,
        { accountId, expiresAt }
      );
      return outcome;
    });
  }
  private passwordError(password: string, login: string): string | null {
    const error = passwordPolicyError(password);
    if (error) return error;
    const normalized = normalizePassword(password).toLowerCase();
    const hash = createHash('sha256').update(normalized).digest('hex');
    const expected = [
      'correct horse battery staple',
      '123456789012345',
      '1234567890123456',
      'dayenglish123456',
      `${login}1234567890`,
      `${login}password`,
    ];
    return commonPasswordHashes.has(hash) || expected.includes(normalized)
      ? 'password_weak'
      : null;
  }
  private async checkPrimary(
    accountId: string,
    credential: string,
    type: 'password' | 'key'
  ): Promise<boolean> {
    const state = await this.security.account(accountId);
    if (type === 'password')
      return Boolean(
        state.passwordHash &&
        (await verifyVerifier(
          normalizePassword(credential),
          state.passwordHash
        ))
      );
    if (state.legacyDisabled) return false;
    const old = await this.security.auth.getAccount(accountId);
    return Boolean(old && (await verifyVerifier(credential, old.verifierHash)));
  }
  private async replaceCodes(
    accountId: string,
    row: TotpRow
  ): Promise<string[]> {
    const codes = generateBackupCodes(8),
      state = await this.security.account(accountId);
    await this.totp.put({ ...row, backupHashes: codes.map(hashBackupCode) });
    await this.security.save(accountId, {
      ...state,
      proofRevision: (state.proofRevision ?? 0) + 1,
      codesRevision: randomUUID(),
      codesTotal: 8,
      codesAcknowledged: false,
    });
    return codes;
  }
  private async perform(
    req: AccessRequest,
    claims: AccessClaims | null,
    ip: string
  ): Promise<AccessOutcome> {
    const login = normalizeLogin(req.login ?? ''),
      password = normalizePassword(req.password ?? '');
    const owner = claims?.sub;
    if (req.action === 'register') {
      if (!validLogin(login)) return reject('login_invalid');
      const error = this.passwordError(password, login);
      if (error) return reject(error);
      if (!(await this.security.auth.hitRegisterRate(ip, WINDOW, 12)))
        return reject('rate_limited', 429);
      if (await this.lookup(login)) return reject('login_taken', 409);
      const accountId = randomUUID();
      if (!(await this.security.auth.createAccount(accountId, 'disabled')))
        throw new Error('Account creation failed');
      await this.security.save(accountId, {
        generation: 0,
        login,
        passwordHash: await hashVerifier(password),
        legacyDisabled: true,
      });
      await this.security.rows.put(
        `login:${this.key('login', login)}`,
        accountId,
        { accountId }
      );
      const session = await this.security.session(
        accountId,
        req.deviceName,
        req.deviceId,
        true
      );
      return accept({
        action: req.action,
        accountId,
        session,
        account: await this.status(accountId),
      });
    }
    if (req.action === 'login') {
      if (!(await this.rate('login-name', login, 15)))
        return reject('rate_limited', 429);
      const accountId = await this.lookup(login);
      const state = accountId
        ? await this.security.account(accountId)
        : undefined;
      dummyHash ??= hashVerifier('public dummy verification value');
      const correct = await verifyVerifier(
        password,
        state?.passwordHash ?? (await dummyHash)
      );
      if (!accountId || state?.deleted || !correct)
        return reject('invalid_credentials', 401);
      return accept({
        action: req.action,
        accountId,
        session: await this.security.session(
          accountId,
          req.deviceName,
          req.deviceId
        ),
        account: await this.status(accountId),
      });
    }
    if (req.action === 'recover') return this.recover(req);
    if (req.action === 'reset') {
      const error = this.passwordError(password, login);
      if (error) return reject(error);
      const proof = await this.consumeProof(req.proof, 'reset', null, false);
      if (!proof) return reject('proof_expired', 401);
      const state = await this.security.account(proof.accountId);
      const selected = state.login ?? login;
      const selectedError = this.passwordError(password, selected);
      if (selectedError) return reject(selectedError);
      if (!validLogin(selected)) return reject('login_invalid');
      const holder = await this.lookup(selected);
      if (holder && holder !== proof.accountId)
        return reject('login_taken', 409);
      if (!(await this.consumeProof(req.proof, 'reset')))
        return reject('proof_expired', 401);
      await this.security.rows.put(
        `login:${this.key('login', selected)}`,
        proof.accountId,
        { accountId: proof.accountId }
      );
      await this.security.save(proof.accountId, {
        ...state,
        login: selected,
        passwordHash: await hashVerifier(password),
        generation: state.generation + 1,
        legacyDisabled: true,
      });
      await this.security.auth.setVerifier(proof.accountId, 'disabled');
      for (const device of await this.security.auth.listDevices(
        proof.accountId
      ))
        await this.security.auth.revokeDevice(proof.accountId, device.deviceId);
      return accept({
        action: req.action,
        accountId: proof.accountId,
        login: selected,
        completed: true,
      });
    }
    if (!owner || !claims) return reject('unauthorized', 401);
    if (req.action === 'reauth') {
      if (!req.purpose) return reject('bad_request');
      if (!(await this.rate('reauth', owner, 15)))
        return reject('rate_limited', 429);
      if (
        !(await this.checkPrimary(
          owner,
          req.credential ?? '',
          req.credentialType ?? 'password'
        ))
      )
        return reject('invalid_credentials', 401);
      return accept({
        action: req.action,
        accountId: owner,
        ...(await this.proof(owner, req.purpose, claims.deviceId)),
      });
    }
    if (req.action === 'attach' || req.action === 'change-password') {
      const state = await this.security.account(owner);
      if (req.action === 'attach' && !validLogin(login))
        return reject('login_invalid');
      if (req.action === 'attach' && state.login)
        return reject('login_already_attached', 409);
      const selected = state.login ?? login;
      const error = this.passwordError(password, selected);
      if (error) return reject(error);
      if (req.action === 'attach' && (await this.lookup(selected)))
        return reject('login_taken', 409);
      const proof = await this.consumeProof(
        req.proof,
        req.action === 'attach' ? 'attach' : 'password',
        claims
      );
      if (!proof) return reject('proof_expired', 401);
      const changingPassword = req.action === 'change-password';
      await this.security.save(owner, {
        ...state,
        login: selected,
        passwordHash: await hashVerifier(password),
        proofRevision: (state.proofRevision ?? 0) + 1,
        generation: state.generation + (changingPassword ? 1 : 0),
      });
      await this.security.rows.put(
        `login:${this.key('login', selected)}`,
        owner,
        { accountId: owner }
      );
      if (changingPassword) {
        for (const device of await this.security.auth.listDevices(owner))
          if (device.deviceId !== claims.deviceId)
            await this.security.auth.revokeDevice(owner, device.deviceId);
      }
      return accept({
        action: req.action,
        accountId: owner,
        account: await this.status(owner),
        completed: true,
        ...(changingPassword
          ? {
              session: await this.security.session(
                owner,
                undefined,
                claims.deviceId
              ),
            }
          : {}),
      });
    }
    if (req.action === 'enroll') {
      const current = await this.totp.get(owner);
      if (current?.confirmedAt) return reject('recovery_already_enabled', 409);
      if (!(await this.consumeProof(req.proof, 'setup', claims)))
        return reject('proof_expired', 401);
      const seed = generateSecret(),
        token = secret(),
        state = await this.security.account(owner),
        expiresAt = Date.now() + TTL;
      await this.security.rows.put(
        `enrollment:${this.key('enrollment', token)}`,
        {
          accountId: owner,
          generation: state.generation,
          revision: state.proofRevision ?? 0,
          deviceId: claims.deviceId,
          secretEnc: sealSecret(seed, this.sealingKey()),
          expiresAt,
          used: false,
        } satisfies Enrollment,
        { accountId: owner, expiresAt }
      );
      return accept({
        action: req.action,
        accountId: owner,
        expiresAt,
        enrollment: {
          id: token,
          secret: base32Encode(seed),
          uri: otpauthUri(state.login ?? owner, seed),
        },
      });
    }
    if (req.action === 'confirm' || req.action === 'cancel-enrollment')
      return this.enrollment(req, claims);
    if (req.action === 'codes') {
      const row = await this.totp.get(owner);
      if (!row?.confirmedAt) return reject('recovery_unavailable', 409);
      if (!(await this.consumeProof(req.proof, 'codes', claims)))
        return reject('proof_expired', 401);
      const codes = await this.replaceCodes(owner, row);
      return accept({
        action: req.action,
        accountId: owner,
        account: await this.status(owner),
        codes,
      });
    }
    if (req.action === 'acknowledge') {
      const state = await this.security.account(owner);
      if (!state.codesRevision || req.codesRevision !== state.codesRevision)
        return reject('codes_changed', 409);
      await this.security.save(owner, { ...state, codesAcknowledged: true });
      return accept({
        action: req.action,
        accountId: owner,
        account: await this.status(owner),
        completed: true,
      });
    }
    return reject('bad_request');
  }
  private async enrollment(
    req: AccessRequest,
    claims: AccessClaims
  ): Promise<AccessOutcome> {
    const key = `enrollment:${this.key('enrollment', req.enrollmentId ?? '')}`;
    const enrollment = await this.security.rows.get<Enrollment>(key),
      state = await this.security.account(claims.sub);
    if (
      !enrollment ||
      enrollment.accountId !== claims.sub ||
      enrollment.deviceId !== claims.deviceId ||
      enrollment.used ||
      enrollment.generation !== state.generation ||
      enrollment.revision !== (state.proofRevision ?? 0) ||
      enrollment.expiresAt <= Date.now()
    )
      return reject('enrollment_expired', 401);
    if (req.action === 'cancel-enrollment') {
      await this.security.rows.remove(key);
      return accept({
        action: req.action,
        accountId: claims.sub,
        completed: true,
      });
    }
    if (!(await this.rate('confirm', claims.sub, 10)))
      return reject('rate_limited', 429);
    const current = await this.totp.get(claims.sub);
    if (current?.confirmedAt) return reject('recovery_already_enabled', 409);
    const code = verifyCode(
      openSecret(enrollment.secretEnc, this.sealingKey()),
      (req.code ?? '').replace(/[\s-]/g, ''),
      Date.now()
    );
    if (!code.ok) return reject('invalid_code', 401);
    const codes = await this.replaceCodes(claims.sub, {
      accountId: claims.sub,
      secretEnc: enrollment.secretEnc,
      confirmedAt: Date.now(),
      lastStep: code.step,
      backupHashes: [],
      failCount: 0,
      failWindowStart: 0,
    });
    await this.security.rows.put(
      key,
      { ...enrollment, used: true },
      { accountId: claims.sub, expiresAt: enrollment.expiresAt }
    );
    return accept({
      action: req.action,
      accountId: claims.sub,
      account: await this.status(claims.sub),
      codes,
    });
  }
  private async recover(req: AccessRequest): Promise<AccessOutcome> {
    const login = req.legacy
      ? normalizeName(req.login ?? '')
      : normalizeLogin(req.login ?? '');
    let candidates: string[];
    if (req.legacy) {
      candidates = await this.names.candidates(nameHash(login));
      if (
        !candidates.length &&
        (await this.security.auth.getAccount(req.login ?? ''))
      )
        candidates = [req.login!];
    } else {
      const holder = await this.lookup(login);
      candidates = holder ? [holder] : [];
    }
    const submitted = (req.code ?? '').replace(/[\s-]/g, '');
    const backup = submitted.length > 6;
    if (
      !backup &&
      !(await this.rate(
        'recover-name',
        `${req.legacy ? 'legacy:' : ''}${login}`,
        10,
        Math.max(1, candidates.length)
      ))
    )
      return reject('rate_limited', 429);
    const matched: { accountId: string; row: TotpRow }[] = [];
    for (const accountId of candidates) {
      const row = await this.totp.get(accountId);
      if (!row?.confirmedAt) continue;
      const seed = openSecret(row.secretEnc, this.sealingKey());
      const result = req.legacy
        ? verifyUncounted(row, seed, submitted, Date.now())
        : verifyAttempt(row, seed, submitted, Date.now(), 'anon');
      if (!req.legacy && 'row' in result) await this.totp.put(result.row);
      if (!result.ok) continue;
      matched.push({ accountId, row: result.row });
    }
    if (matched.length === 1) {
      const match = matched[0]!;
      if (req.legacy) await this.totp.put(match.row);
      const state = await this.security.account(match.accountId);
      return accept({
        action: req.action,
        accountId: match.accountId,
        login: state.login ?? null,
        ...(await this.proof(match.accountId, 'reset')),
      });
    }
    return reject('invalid_recovery', 401);
  }
}
