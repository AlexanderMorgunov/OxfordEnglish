import ydbSdk from 'ydb-sdk';
import {
  FeatureEditSchema, FeatureSettingsSchema, initialFeatureSettings, nextFeatureSettings,
  type FeatureKey, type FeatureSettingsStore,
} from '../featureSettings.js';
import { atomicQuery, query, TypedValues as T } from '../ydb.js';

export class YdbFeatureSettingsStore implements FeatureSettingsStore {
  private ready = false;
  async exists(): Promise<boolean> {
    if (this.ready) return true;
    try {
      await query('SELECT feature_key FROM feature_settings LIMIT 0;');
      this.ready = true;
      return true;
    } catch (error) {
      if (error instanceof ydbSdk.YdbError &&
          Reflect.get(error.constructor, 'status') === ydbSdk.StatusCode.SCHEME_ERROR &&
          /(?:path|table).*feature_settings.*(?:does not exist|not found)|(?:cannot find|unknown) table.*feature_settings/i.test(error.message))
        return false;
      throw error;
    }
  }
  async get(key: FeatureKey) {
    const [rows] = await query(
      'DECLARE $k AS Utf8; SELECT payload FROM feature_settings WHERE feature_key=$k;',
      { $k: T.utf8(key) },
    );
    if (!rows.length) return initialFeatureSettings();
    return FeatureSettingsSchema.parse(JSON.parse(String(rows[0]?.payload)));
  }
  async replace(key: FeatureKey, edit: Parameters<FeatureSettingsStore['replace']>[1]) {
    return atomicQuery(async () => {
      const current = await this.get(key);
      if (current.revision !== edit.expectedRevision) return null;
      const next = nextFeatureSettings(current.revision, FeatureEditSchema.parse(edit));
      await query(
        'DECLARE $k AS Utf8; DECLARE $p AS Utf8; UPSERT INTO feature_settings (feature_key, payload) VALUES ($k, $p);',
        { $k: T.utf8(key), $p: T.utf8(JSON.stringify(next)) },
      );
      return next;
    });
  }
}
