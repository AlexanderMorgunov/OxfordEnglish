import { Hono, type Context } from 'hono';
import { bearerClaims } from '../tokens.js';
import {
  featureAllowed, FEATURE_VALID_FOR_MS, GAME_FEATURE, initialFeatureSettings, type FeatureSettingsStore,
} from '../featureSettings.js';

export type GameRollout = {
  ready: boolean;
  store: FeatureSettingsStore;
};

export function privateResponse(c: Context): void {
  c.header('Cache-Control', 'private, no-store');
  const vary = new Set((c.res.headers.get('Vary') ?? '').split(',').map((value) => value.trim().toLowerCase()));
  if (!vary.has('origin')) c.header('Vary', 'Origin', { append: true });
  if (!vary.has('authorization')) c.header('Vary', 'Authorization', { append: true });
}

export async function gameDecision(c: Context, rollout: GameRollout) {
  try {
    const claims = await bearerClaims(c);
    if (c.req.header('authorization') !== undefined && !claims)
      return { status: 401, code: 'unauthorized' } as const;
    const settings = rollout.ready ? await rollout.store.get(GAME_FEATURE) : initialFeatureSettings();
    return {
      status: 200,
      allowed: rollout.ready && featureAllowed(settings, claims?.sub),
      androidEnabled: settings.androidEnabled,
      revision: settings.revision,
      claims,
    } as const;
  } catch {
    return { status: 503, code: 'unavailable' } as const;
  }
}

export function featureRoutes(rollout: GameRollout) {
  return new Hono().get('/v1/features', async (c) => {
    const decision = await gameDecision(c, rollout);
    if (decision.status !== 200)
      return c.json({ error: { code: decision.code } }, decision.status);
    return c.json({
      version: 1,
      validForMs: FEATURE_VALID_FOR_MS,
      features: {
        [GAME_FEATURE]: {
          allowed: decision.allowed,
          androidAllowed: decision.allowed && decision.androidEnabled,
          revision: decision.revision,
        },
      },
    });
  });
}
