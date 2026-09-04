/**
 * AuthStore on YDB (Track B). Tables: accounts, devices, refresh_tokens (+ by_family index),
 * link_requests (+ by_code index). Refresh rotation + reuse-detection run in a serializable transaction;
 * a reuse revokes the whole token family. Verifier hashing is done in the route (argon2id); this store
 * only persists the opaque hash. See docs/yc-backend-setup.md for the schema.
 */
import { randomBytes, createHash } from 'node:crypto';
import type { AuthStore } from '../store.js';
import type { Device } from '../contract.js';
import { query, withSerializableTx, TypedValues as T, Types, type Tx } from '../ydb.js';

const newRefreshToken = (): string => randomBytes(32).toString('base64url');
const hashToken = (t: string): string => createHash('sha256').update(t).digest('base64');
const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000; // per-device sliding cap (design H4)
const LINK_TTL_MS = 5 * 60 * 1000; // roomy for a scan flow (camera permission + aim); auto-refreshed client-side

/** YDB Timestamp comes back as a Date (or micros); normalize to epoch ms. */
function tsMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Math.floor(v / 1000);
  if (v != null) return Number((v as { toString(): string }).toString());
  return 0;
}
const str = (v: unknown): string => (v == null ? '' : String(v));

async function revokeFamily(tx: Tx, familyId: string): Promise<void> {
  const [rows] = await tx.exec(
    'DECLARE $fam AS Utf8; SELECT token_hash FROM refresh_tokens VIEW by_family WHERE family_id=$fam;',
    { $fam: T.utf8(familyId) }
  );
  for (const r of rows) {
    await tx.exec('DECLARE $h AS Utf8; UPSERT INTO refresh_tokens (token_hash, revoked) VALUES ($h, true);', { $h: T.utf8(str(r.token_hash)) });
  }
}

export class YdbAuthStore implements AuthStore {
  async getAccount(accountId: string): Promise<{ verifierHash: string } | null> {
    const [rows] = await query('DECLARE $id AS Utf8; SELECT verifier_hash FROM accounts WHERE account_id=$id;', { $id: T.utf8(accountId) });
    return rows[0] ? { verifierHash: str(rows[0].verifier_hash) } : null;
  }

  async createAccount(accountId: string, verifierHash: string): Promise<void> {
    await query(
      'DECLARE $id AS Utf8; DECLARE $vh AS Utf8; DECLARE $ts AS Timestamp; UPSERT INTO accounts (account_id, verifier_hash, created_at) VALUES ($id, $vh, $ts);',
      { $id: T.utf8(accountId), $vh: T.utf8(verifierHash), $ts: T.timestamp(new Date()) }
    );
  }

  async touchDevice(accountId: string, deviceId: string, deviceName?: string): Promise<void> {
    const [rows] = await query(
      'DECLARE $a AS Utf8; DECLARE $d AS Utf8; SELECT created_at, device_name FROM devices WHERE account_id=$a AND device_id=$d;',
      { $a: T.utf8(accountId), $d: T.utf8(deviceId) }
    );
    const now = new Date();
    const created = rows[0]?.created_at != null ? new Date(tsMs(rows[0].created_at)) : now;
    const name = deviceName ?? (rows[0]?.device_name != null ? str(rows[0].device_name) : undefined);
    await query(
      'DECLARE $a AS Utf8; DECLARE $d AS Utf8; DECLARE $n AS Utf8?; DECLARE $c AS Timestamp; DECLARE $l AS Timestamp;' +
        'UPSERT INTO devices (account_id, device_id, device_name, created_at, last_seen_at) VALUES ($a, $d, $n, $c, $l);',
      { $a: T.utf8(accountId), $d: T.utf8(deviceId), $n: name == null ? T.optionalNull(Types.UTF8) : T.optional(T.utf8(name)), $c: T.timestamp(created), $l: T.timestamp(now) }
    );
  }

  async listDevices(accountId: string): Promise<Device[]> {
    const [rows] = await query('DECLARE $a AS Utf8; SELECT device_id, device_name, created_at, last_seen_at FROM devices WHERE account_id=$a;', { $a: T.utf8(accountId) });
    return rows.map((r) => ({
      deviceId: str(r.device_id),
      deviceName: r.device_name == null ? undefined : str(r.device_name),
      createdAt: tsMs(r.created_at),
      lastSeenAt: tsMs(r.last_seen_at),
    }));
  }

  async issueRefresh(accountId: string, deviceId: string): Promise<string> {
    const token = newRefreshToken();
    const familyId = randomBytes(8).toString('hex');
    await query(
      'DECLARE $h AS Utf8; DECLARE $a AS Utf8; DECLARE $d AS Utf8; DECLARE $f AS Utf8; DECLARE $e AS Timestamp;' +
        'UPSERT INTO refresh_tokens (token_hash, account_id, device_id, family_id, used, revoked, expires_at) VALUES ($h, $a, $d, $f, false, false, $e);',
      { $h: T.utf8(hashToken(token)), $a: T.utf8(accountId), $d: T.utf8(deviceId), $f: T.utf8(familyId), $e: T.timestamp(new Date(Date.now() + REFRESH_TTL_MS)) }
    );
    return token;
  }

  async rotateRefresh(token: string): Promise<{ status: 'ok'; token: string; accountId: string; deviceId: string } | { status: 'invalid' } | { status: 'reused' }> {
    const h = hashToken(token);
    return withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(
        'DECLARE $h AS Utf8; SELECT account_id, device_id, family_id, used, revoked, expires_at FROM refresh_tokens WHERE token_hash=$h;',
        { $h: T.utf8(h) }
      );
      const rec = rows[0];
      if (!rec || rec.revoked === true || tsMs(rec.expires_at) < Date.now()) {
        await tx.exec('SELECT 1;', {}, true); // commit the (empty) tx
        return { status: 'invalid' as const };
      }
      if (rec.used === true) {
        await revokeFamily(tx, str(rec.family_id)); // theft signal → kill the family
        await tx.exec('SELECT 1;', {}, true);
        return { status: 'reused' as const };
      }
      const next = newRefreshToken();
      await tx.exec('DECLARE $h AS Utf8; UPSERT INTO refresh_tokens (token_hash, used) VALUES ($h, true);', { $h: T.utf8(h) });
      await tx.exec(
        'DECLARE $h AS Utf8; DECLARE $a AS Utf8; DECLARE $d AS Utf8; DECLARE $f AS Utf8; DECLARE $e AS Timestamp;' +
          'UPSERT INTO refresh_tokens (token_hash, account_id, device_id, family_id, used, revoked, expires_at) VALUES ($h, $a, $d, $f, false, false, $e);',
        { $h: T.utf8(hashToken(next)), $a: T.utf8(str(rec.account_id)), $d: T.utf8(str(rec.device_id)), $f: T.utf8(str(rec.family_id)), $e: T.timestamp(new Date(Date.now() + REFRESH_TTL_MS)) },
        true
      );
      return { status: 'ok' as const, token: next, accountId: str(rec.account_id), deviceId: str(rec.device_id) };
    });
  }

  async revokeByToken(token: string): Promise<void> {
    const [rows] = await query('DECLARE $h AS Utf8; SELECT family_id FROM refresh_tokens WHERE token_hash=$h;', { $h: T.utf8(hashToken(token)) });
    if (rows[0]) await withSerializableTx((tx) => revokeFamily(tx, str(rows[0].family_id)).then(() => tx.exec('SELECT 1;', {}, true)));
  }

  async revokeDevice(accountId: string, deviceId: string): Promise<void> {
    await withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(
        'DECLARE $a AS Utf8; DECLARE $d AS Utf8; SELECT token_hash FROM refresh_tokens WHERE account_id=$a AND device_id=$d;',
        { $a: T.utf8(accountId), $d: T.utf8(deviceId) }
      );
      for (const r of rows) await tx.exec('DECLARE $h AS Utf8; UPSERT INTO refresh_tokens (token_hash, revoked) VALUES ($h, true);', { $h: T.utf8(str(r.token_hash)) });
      await tx.exec('DECLARE $a AS Utf8; DECLARE $d AS Utf8; DELETE FROM devices WHERE account_id=$a AND device_id=$d;', { $a: T.utf8(accountId), $d: T.utf8(deviceId) }, true);
    });
  }

  async deleteAccount(accountId: string): Promise<void> {
    await query('DECLARE $a AS Utf8; DELETE FROM accounts WHERE account_id=$a;', { $a: T.utf8(accountId) });
    await query('DECLARE $a AS Utf8; DELETE FROM devices WHERE account_id=$a;', { $a: T.utf8(accountId) });
    await query('DECLARE $a AS Utf8; DELETE FROM refresh_tokens WHERE account_id=$a;', { $a: T.utf8(accountId) });
    await query('DECLARE $a AS Utf8; DELETE FROM link_requests WHERE account_id=$a;', { $a: T.utf8(accountId) });
  }

  async createLinkRequest(deviceName?: string): Promise<{ requestId: string; code: string; expiresAt: number }> {
    const requestId = randomBytes(16).toString('hex');
    const code = randomBytes(10).toString('base64url');
    const expiresAt = Date.now() + LINK_TTL_MS;
    await query(
      'DECLARE $r AS Utf8; DECLARE $c AS Utf8; DECLARE $n AS Utf8?; DECLARE $e AS Timestamp;' +
        "UPSERT INTO link_requests (request_id, code_hash, new_device_name, status, expires_at) VALUES ($r, $c, $n, 'pending', $e);",
      { $r: T.utf8(requestId), $c: T.utf8(hashToken(code)), $n: deviceName == null ? T.optionalNull(Types.UTF8) : T.optional(T.utf8(deviceName)), $e: T.timestamp(new Date(expiresAt)) }
    );
    return { requestId, code, expiresAt };
  }

  async approveLink(code: string, accountId: string): Promise<{ status: 'ok'; deviceName?: string } | { status: 'not_found' } | { status: 'expired' }> {
    return withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(
        "DECLARE $c AS Utf8; SELECT request_id, new_device_name, status, expires_at FROM link_requests VIEW by_code WHERE code_hash=$c AND status='pending';",
        { $c: T.utf8(hashToken(code)) }
      );
      const req = rows[0];
      if (!req) {
        await tx.exec('SELECT 1;', {}, true);
        return { status: 'not_found' as const };
      }
      if (tsMs(req.expires_at) < Date.now()) {
        await tx.exec("DECLARE $r AS Utf8; UPSERT INTO link_requests (request_id, status) VALUES ($r, 'expired');", { $r: T.utf8(str(req.request_id)) }, true);
        return { status: 'expired' as const };
      }
      const deviceId = randomBytes(8).toString('hex');
      const deviceName = req.new_device_name == null ? undefined : str(req.new_device_name);
      const token = newRefreshToken();
      const familyId = randomBytes(8).toString('hex');
      const now = new Date();
      await tx.exec(
        'DECLARE $a AS Utf8; DECLARE $d AS Utf8; DECLARE $n AS Utf8?; DECLARE $c AS Timestamp;' +
          'UPSERT INTO devices (account_id, device_id, device_name, created_at, last_seen_at) VALUES ($a, $d, $n, $c, $c);',
        { $a: T.utf8(accountId), $d: T.utf8(deviceId), $n: deviceName == null ? T.optionalNull(Types.UTF8) : T.optional(T.utf8(deviceName)), $c: T.timestamp(now) }
      );
      await tx.exec(
        'DECLARE $h AS Utf8; DECLARE $a AS Utf8; DECLARE $d AS Utf8; DECLARE $f AS Utf8; DECLARE $e AS Timestamp;' +
          'UPSERT INTO refresh_tokens (token_hash, account_id, device_id, family_id, used, revoked, expires_at) VALUES ($h, $a, $d, $f, false, false, $e);',
        { $h: T.utf8(hashToken(token)), $a: T.utf8(accountId), $d: T.utf8(deviceId), $f: T.utf8(familyId), $e: T.timestamp(new Date(Date.now() + REFRESH_TTL_MS)) }
      );
      await tx.exec(
        "DECLARE $r AS Utf8; DECLARE $a AS Utf8; DECLARE $d AS Utf8; DECLARE $t AS Utf8;" +
          "UPSERT INTO link_requests (request_id, status, account_id, device_id, refresh_token) VALUES ($r, 'approved', $a, $d, $t);",
        { $r: T.utf8(str(req.request_id)), $a: T.utf8(accountId), $d: T.utf8(deviceId), $t: T.utf8(token) },
        true
      );
      return { status: 'ok' as const, deviceName };
    });
  }

  async consumeApprovedLink(
    requestId: string
  ): Promise<{ status: 'pending' } | { status: 'expired' } | { status: 'approved'; accountId: string; deviceId: string; refreshToken: string }> {
    return withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(
        'DECLARE $r AS Utf8; SELECT status, account_id, device_id, refresh_token, expires_at FROM link_requests WHERE request_id=$r;',
        { $r: T.utf8(requestId) }
      );
      const req = rows[0];
      if (!req) {
        await tx.exec('SELECT 1;', {}, true);
        return { status: 'expired' as const };
      }
      if (req.status === 'approved') {
        await tx.exec('DECLARE $r AS Utf8; DELETE FROM link_requests WHERE request_id=$r;', { $r: T.utf8(requestId) }, true); // one-time
        return { status: 'approved' as const, accountId: str(req.account_id), deviceId: str(req.device_id), refreshToken: str(req.refresh_token) };
      }
      if (tsMs(req.expires_at) < Date.now()) {
        await tx.exec('DECLARE $r AS Utf8; DELETE FROM link_requests WHERE request_id=$r;', { $r: T.utf8(requestId) }, true);
        return { status: 'expired' as const };
      }
      await tx.exec('SELECT 1;', {}, true);
      return { status: 'pending' as const };
    });
  }
}
