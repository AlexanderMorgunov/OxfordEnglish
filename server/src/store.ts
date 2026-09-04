/**
 * Persistence boundary for auth. The route layer talks only to `AuthStore`, so swapping the in-memory
 * skeleton for the YDB implementation later is isolated. Secrets are never stored raw:
 *  - the client's `verifier` is scrypt-hashed here (production: argon2id),
 *  - refresh tokens are stored by their SHA-256 hash (the raw token lives only on the client).
 */
import { randomBytes, createHash } from 'node:crypto';
import type { Device } from './contract.js';

const newRefreshToken = (): string => randomBytes(32).toString('base64url');
const hashToken = (t: string): string => createHash('sha256').update(t).digest('base64');

type RefreshRec = { accountId: string; deviceId: string; familyId: string; used: boolean };
type LinkReq = {
  codeHash: string;
  newDeviceName?: string;
  status: 'pending' | 'approved' | 'expired';
  expiresAt: number;
  accountId?: string;
  deviceId?: string;
  refreshToken?: string;
};
type RotateResult =
  | { status: 'ok'; token: string; accountId: string; deviceId: string }
  | { status: 'invalid' }
  | { status: 'reused' };

export interface AuthStore {
  getAccount(accountId: string): Promise<{ verifierHash: string } | null>;
  createAccount(accountId: string, verifierHash: string): Promise<void>;
  /** Record/refresh a device's presence for the revoke list. */
  touchDevice(accountId: string, deviceId: string, deviceName?: string): Promise<void>;
  listDevices(accountId: string): Promise<Device[]>;
  /** Issue a fresh refresh token for a new session (returns the raw token to hand to the client). */
  issueRefresh(accountId: string, deviceId: string): Promise<string>;
  /** Rotate: invalidate the presented token, issue its successor. Detects reuse of an already-rotated
   *  token and, on reuse, revokes the whole family (see design H4). */
  rotateRefresh(token: string): Promise<RotateResult>;
  revokeByToken(token: string): Promise<void>;
  /** Revoke a device: kill all its refresh families and drop it from the device list. */
  revokeDevice(accountId: string, deviceId: string): Promise<void>;
  /** Delete-account: remove the account + all its refresh tokens, devices, and link requests (152-ФЗ). */
  deleteAccount(accountId: string): Promise<void>;

  // --- Device linking by approval ---
  createLinkRequest(deviceName?: string): Promise<{ requestId: string; code: string; expiresAt: number }>;
  approveLink(code: string, accountId: string): Promise<{ status: 'ok'; deviceName?: string } | { status: 'not_found' } | { status: 'expired' }>;
  /** Poll a pending request; once approved, returns the new device's session bits ONCE (then consumed). */
  consumeApprovedLink(requestId: string): Promise<
    | { status: 'pending' }
    | { status: 'expired' }
    | { status: 'approved'; accountId: string; deviceId: string; refreshToken: string }
  >;
}

export class InMemoryAuthStore implements AuthStore {
  private accounts = new Map<string, { verifierHash: string }>();
  private refresh = new Map<string, RefreshRec>(); // key = hashToken(raw)
  private revokedFamilies = new Set<string>();
  private devices = new Map<string, Map<string, Device>>();
  private deviceFamilies = new Map<string, Set<string>>(); // `${accountId}:${deviceId}` -> familyIds
  private links = new Map<string, LinkReq>(); // requestId -> pending/approved link

  async getAccount(accountId: string) {
    return this.accounts.get(accountId) ?? null;
  }
  async createAccount(accountId: string, verifierHash: string) {
    this.accounts.set(accountId, { verifierHash });
  }
  async touchDevice(accountId: string, deviceId: string, deviceName?: string) {
    const map = this.devices.get(accountId) ?? new Map<string, Device>();
    const now = Date.now();
    const existing = map.get(deviceId);
    map.set(deviceId, {
      deviceId,
      deviceName: deviceName ?? existing?.deviceName,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
    });
    this.devices.set(accountId, map);
  }
  async listDevices(accountId: string) {
    return [...(this.devices.get(accountId)?.values() ?? [])];
  }
  async issueRefresh(accountId: string, deviceId: string) {
    const token = newRefreshToken();
    const familyId = randomBytes(8).toString('hex');
    this.refresh.set(hashToken(token), { accountId, deviceId, familyId, used: false });
    const key = `${accountId}:${deviceId}`;
    const fams = this.deviceFamilies.get(key) ?? new Set<string>();
    fams.add(familyId);
    this.deviceFamilies.set(key, fams);
    return token;
  }
  async rotateRefresh(token: string): Promise<RotateResult> {
    const h = hashToken(token);
    const rec = this.refresh.get(h);
    if (!rec || this.revokedFamilies.has(rec.familyId)) return { status: 'invalid' };
    if (rec.used) {
      // A rotated token presented again = theft signal → kill the whole family.
      this.revokedFamilies.add(rec.familyId);
      return { status: 'reused' };
    }
    rec.used = true;
    const next = newRefreshToken();
    this.refresh.set(hashToken(next), { accountId: rec.accountId, deviceId: rec.deviceId, familyId: rec.familyId, used: false });
    return { status: 'ok', token: next, accountId: rec.accountId, deviceId: rec.deviceId };
  }
  async revokeByToken(token: string) {
    const rec = this.refresh.get(hashToken(token));
    if (rec) this.revokedFamilies.add(rec.familyId);
  }
  async revokeDevice(accountId: string, deviceId: string) {
    const key = `${accountId}:${deviceId}`;
    for (const fam of this.deviceFamilies.get(key) ?? []) this.revokedFamilies.add(fam);
    this.deviceFamilies.delete(key);
    this.devices.get(accountId)?.delete(deviceId);
  }
  async deleteAccount(accountId: string) {
    this.accounts.delete(accountId);
    this.devices.delete(accountId);
    for (const [h, rec] of this.refresh) if (rec.accountId === accountId) this.refresh.delete(h);
    for (const k of this.deviceFamilies.keys()) if (k.startsWith(`${accountId}:`)) this.deviceFamilies.delete(k);
    for (const [id, req] of this.links) if (req.accountId === accountId) this.links.delete(id);
  }

  async createLinkRequest(deviceName?: string) {
    const requestId = randomBytes(16).toString('hex');
    const code = randomBytes(10).toString('base64url'); // ~80-bit, QR/type-able
    const expiresAt = Date.now() + 5 * 60_000; // 5 min — roomy for a scan flow (client auto-refreshes)
    this.links.set(requestId, { codeHash: hashToken(code), newDeviceName: deviceName, status: 'pending', expiresAt });
    return { requestId, code, expiresAt };
  }
  async approveLink(code: string, accountId: string) {
    const h = hashToken(code);
    const found = [...this.links.values()].find((r) => r.codeHash === h && r.status === 'pending');
    if (!found) return { status: 'not_found' as const };
    if (Date.now() > found.expiresAt) {
      found.status = 'expired';
      return { status: 'expired' as const };
    }
    const deviceId = randomBytes(8).toString('hex'); // server-assigned to the new device
    await this.touchDevice(accountId, deviceId, found.newDeviceName);
    const refreshToken = await this.issueRefresh(accountId, deviceId);
    found.status = 'approved';
    found.accountId = accountId;
    found.deviceId = deviceId;
    found.refreshToken = refreshToken;
    return { status: 'ok' as const, deviceName: found.newDeviceName };
  }
  async consumeApprovedLink(requestId: string) {
    const req = this.links.get(requestId);
    if (!req) return { status: 'expired' as const };
    if (req.status === 'approved') {
      this.links.delete(requestId); // one-time
      return { status: 'approved' as const, accountId: req.accountId!, deviceId: req.deviceId!, refreshToken: req.refreshToken! };
    }
    if (Date.now() > req.expiresAt) {
      this.links.delete(requestId);
      return { status: 'expired' as const };
    }
    return { status: 'pending' as const };
  }
}
