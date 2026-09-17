import { Hono } from 'hono';
import { bearerClaims } from '../tokens.js';
import { ErrorCode } from '../contract.js';
import type { AuthStore } from '../store.js';
import type { SyncStore } from '../sync.js';
import type { BlobStore } from '../blobs.js';
import type { EntitlementStore } from '../entitlements.js';
import type { TotpStore } from '../totp.js';
import type { RecoveryNameStore } from '../recoveryName.js';

const err = (code: string, status: 401) => Response.json({ error: { code } }, { status });

/** Delete-account (152-ФЗ right to erasure): purge the caller's blobs, synced data, and auth records. */
export function accountRoutes(
  auth: AuthStore,
  sync: SyncStore,
  blobs: BlobStore,
  ent: EntitlementStore,
  totp: TotpStore,
  names: RecoveryNameStore
): Hono {
  const app = new Hono();

  app.delete('/v1/account', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const userId = claims.sub;
    await blobs.gcOrphans(userId, []); // no known books → removes every blob (S3 objects + book_blobs rows)
    await sync.purge(userId); // changelog + current_state + seq_counter + idempotency
    await auth.deleteAccount(userId); // account + refresh tokens + devices + link requests
    // Entitlement goes too; the trial-claim marker deliberately does NOT — it is what stops a fresh
    // account on the same install from drawing a second trial.
    await ent.purge(userId);
    await totp.remove(userId); // the sealed seed must not outlive the account it unlocks
    // The recovery-name row is the one place an account id sits beside anything user-chosen, so it has
    // to go with the account. The name's shared attempt counter deliberately stays: it belongs to
    // everyone else who picked that name.
    await names.purge(userId);
    return c.json({ ok: true });
  });

  return app;
}
