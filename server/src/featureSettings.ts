import { z } from 'zod';
import { CredentialsSchema } from './contract.js';

export const GAME_FEATURE = 'games_catalog';
export const FeatureKeySchema = z.enum([GAME_FEATURE]);
export type FeatureKey = z.infer<typeof FeatureKeySchema>;
export const FEATURE_VALID_FOR_MS = 30_000;

export const TesterIdSchema = CredentialsSchema.shape.accountId.refine(
  (id) => id.trim() === id,
);
const settingsFields = {
  mode: z.enum(['off', 'testing', 'public']),
  androidEnabled: z.boolean().default(false),
  testAccountIds: z.array(TesterIdSchema).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
  ),
};
export const FeatureEditSchema = z.object({
  ...settingsFields,
  expectedRevision: z.number().int().nonnegative().safe(),
}).strict();
export const FeatureSettingsSchema = z.object({
  ...settingsFields,
  revision: z.number().int().nonnegative().safe(),
  updatedAt: z.number().int().positive().safe().nullable(),
}).strict();
export type FeatureEdit = z.infer<typeof FeatureEditSchema>;
export type FeatureSettings = z.infer<typeof FeatureSettingsSchema>;
export const initialFeatureSettings = (): FeatureSettings => ({
  mode: 'off', androidEnabled: false, testAccountIds: [], revision: 0, updatedAt: null,
});

export function featureAllowed(settings: FeatureSettings, accountId?: string): boolean {
  return settings.mode === 'public' ||
    (settings.mode === 'testing' && accountId !== undefined && settings.testAccountIds.includes(accountId));
}

export function nextFeatureSettings(revision: number, edit: FeatureEdit): FeatureSettings {
  return {
    mode: edit.mode,
    androidEnabled: edit.androidEnabled,
    testAccountIds: [...edit.testAccountIds],
    revision: revision + 1,
    updatedAt: Date.now(),
  };
}

export interface FeatureSettingsStore {
  exists(): Promise<boolean>;
  get(key: FeatureKey): Promise<FeatureSettings>;
  replace(key: FeatureKey, edit: z.input<typeof FeatureEditSchema>): Promise<FeatureSettings | null>;
}

export class InMemoryFeatureSettingsStore implements FeatureSettingsStore {
  private rows = new Map<FeatureKey, FeatureSettings>();
  checkpoint(): () => void {
    const before = structuredClone(this.rows);
    return () => { this.rows = before; };
  }
  async exists() { return true; }
  async get(key: FeatureKey) {
    return structuredClone(this.rows.get(key) ?? initialFeatureSettings());
  }
  async replace(key: FeatureKey, edit: z.input<typeof FeatureEditSchema>) {
    const revision = this.rows.get(key)?.revision ?? 0;
    if (revision !== edit.expectedRevision) return null;
    const next = nextFeatureSettings(revision, FeatureEditSchema.parse(edit));
    this.rows.set(key, next);
    return structuredClone(next);
  }
}
