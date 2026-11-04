import { createHash, randomUUID } from 'node:crypto';
import type { AccessStore } from './accessStore.js';
import type { AuthStore } from './store.js';
import { signAccess } from './tokens.js';
import type { Session } from './contract.js';

export type AccessAccount = {
  generation: number;
  proofRevision?: number;
  login?: string;
  passwordHash?: string;
  legacyDisabled?: boolean;
  deleted?: boolean;
  codesRevision?: string;
  codesTotal?: number;
  codesAcknowledged?: boolean;
};
type Version = { generation: number; accountId: string };
const digest = (text: string) =>
  createHash('sha256').update(text).digest('base64url');
const REFRESH_TTL = 365 * 24 * 60 * 60 * 1000;

export class AccessSecurity {
  constructor(
    readonly rows: AccessStore,
    readonly auth: AuthStore
  ) {}
  async account(accountId: string): Promise<AccessAccount> {
    return (
      (await this.rows.get<AccessAccount>(`account:${accountId}`)) ?? {
        generation: 0,
      }
    );
  }
  async save(accountId: string, state: AccessAccount): Promise<void> {
    await this.rows.put(`account:${accountId}`, state, { accountId });
  }
  async validAccess(claims: {
    sub: string;
    authVersion?: number;
  }): Promise<boolean> {
    if (!(await this.rows.available())) {
      const account = await this.auth.getAccount(claims.sub);
      return (
        (claims.authVersion ?? 0) === 0 &&
        Boolean(account && account.verifierHash !== 'disabled')
      );
    }
    const state = await this.rows.get<AccessAccount>(`account:${claims.sub}`);
    if (state)
      return (
        !state.deleted &&
        state.generation === (claims.authVersion ?? 0) &&
        Boolean(await this.auth.getAccount(claims.sub))
      );
    return (
      (claims.authVersion ?? 0) === 0 &&
      Boolean(await this.auth.getAccount(claims.sub))
    );
  }
  async legacyAllowed(accountId: string): Promise<boolean> {
    if (!(await this.rows.available())) return true;
    const state = await this.account(accountId);
    return !state.legacyDisabled && !state.deleted;
  }
  async rememberRefresh(
    token: string,
    accountId: string,
    generation: number
  ): Promise<void> {
    await this.rows.put(
      `refresh:${digest(token)}`,
      { accountId, generation },
      { accountId, expiresAt: Date.now() + REFRESH_TTL }
    );
  }
  async refreshAllowed(token: string, accountId: string): Promise<boolean> {
    const state = await this.account(accountId);
    const issued = await this.rows.get<Version>(`refresh:${digest(token)}`);
    return (
      !state.deleted &&
      state.generation === (issued?.generation ?? 0) &&
      (!issued || issued.accountId === accountId)
    );
  }
  async session(
    accountId: string,
    deviceName?: string,
    deviceId?: string,
    created = false
  ): Promise<Session> {
    const state = await this.account(accountId);
    if (state.deleted || !(await this.auth.getAccount(accountId)))
      throw new Error('Account is unavailable');
    const device = deviceId ?? randomUUID();
    await this.auth.touchDevice(accountId, device, deviceName);
    const refreshToken = await this.auth.issueRefresh(accountId, device);
    await this.rememberRefresh(refreshToken, accountId, state.generation);
    const access = await signAccess(accountId, device, state.generation);
    return {
      accountId,
      deviceId: device,
      refreshToken,
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      created,
    };
  }
  async rememberLink(requestId: string, code: string): Promise<void> {
    await this.rows.put(
      `link-code:${digest(code)}`,
      { requestId },
      { expiresAt: Date.now() + 5 * 60_000 }
    );
  }
  async approveLink(code: string, accountId: string): Promise<void> {
    const link = await this.rows.get<{ requestId: string }>(
      `link-code:${digest(code)}`
    );
    if (!link) return;
    const { generation } = await this.account(accountId);
    await this.rows.put(
      `link:${link.requestId}`,
      { accountId, generation },
      { accountId, expiresAt: Date.now() + 5 * 60_000 }
    );
  }
  async linkAllowed(requestId: string, accountId: string): Promise<boolean> {
    const approval = await this.rows.get<Version>(`link:${requestId}`);
    const state = await this.account(accountId);
    return (
      !state.deleted &&
      state.generation === (approval?.generation ?? 0) &&
      (!approval || approval.accountId === accountId)
    );
  }
}
