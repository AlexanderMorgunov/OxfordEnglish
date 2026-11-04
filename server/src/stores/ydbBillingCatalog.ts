import {
  CatalogSettingsSchema,
  initialCatalogSettings,
  type BillingCatalogStore,
  type CatalogSettings,
} from '../billingCatalog.js';
import { query, withSerializableTx, TypedValues as T } from '../ydb.js';

const readQuery =
  'DECLARE $k AS Utf8; SELECT payload FROM billing_catalog WHERE catalog_key=$k;';
const decode = (rows: Record<string, unknown>[]): CatalogSettings =>
  rows[0]?.payload == null
    ? initialCatalogSettings()
    : CatalogSettingsSchema.parse(JSON.parse(String(rows[0].payload)));

export class YdbBillingCatalogStore implements BillingCatalogStore {
  async get() {
    const [rows] = await query(readQuery, { $k: T.utf8('pro') });
    return decode(rows);
  }
  async replace(
    expectedRevision: number,
    campaign: CatalogSettings['campaign']
  ) {
    return withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(readQuery, { $k: T.utf8('pro') });
      const current = decode(rows);
      if (current.revision !== expectedRevision) {
        await tx.exec('SELECT 1;', {}, true);
        return null;
      }
      const next = { revision: expectedRevision + 1, campaign };
      await tx.exec(
        'DECLARE $k AS Utf8; DECLARE $p AS Utf8; UPSERT INTO billing_catalog (catalog_key, payload) VALUES ($k, $p);',
        { $k: T.utf8('pro'), $p: T.utf8(JSON.stringify(next)) },
        true
      );
      return next;
    });
  }
}
