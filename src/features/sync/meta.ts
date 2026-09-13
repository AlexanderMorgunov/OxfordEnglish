/**
 * The stable install id — this browser's sync identity and the LWW `updatedBy` tiebreaker. It is NOT the
 * account deviceId (which the server reassigns on device-linking), so it lives in its own Dexie row and
 * survives login/logout/link. The v7 migration seeds it for upgrading users; fresh installs mint it lazily.
 */
import { db, INSTALL_ROW } from '@/db/db';

let cached: string | null = null;

export async function getInstallId(): Promise<string> {
  if (cached) return cached;
  const row = await db.syncState.get(INSTALL_ROW);
  if (row?.installId) return (cached = row.installId);
  const installId = crypto.randomUUID();
  await db.syncState.put({ account: INSTALL_ROW, installId });
  return (cached = installId);
}
