import { z } from 'zod';

export const GameId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const GameManifestSchema = z
  .object({
    gameId: GameId.refine((value) => value.toLowerCase() !== 'submit'),
    releaseId: GameId,
    title: z.string().min(1).max(120),
    presentation: z
      .object({
        description: z.string().min(1).max(600),
        subtitle: z.string().max(120).optional(),
        category: z.enum(['grammar', 'words', 'listening']).optional(),
        topics: z.array(z.string().min(1).max(60)).max(8).default([]),
        artwork: z.enum(['lumi']).optional(),
        original: z.boolean().default(false),
        story: z.string().max(2000).optional(),
        chapters: z
          .array(
            z.object({
              title: z.string().min(1).max(120),
              description: z.string().max(300),
            })
          )
          .max(30)
          .default([]),
        controls: z
          .array(z.enum(['keyboard', 'touch']))
          .max(2)
          .default([]),
        saving: z.enum(['checkpoints', 'session']).optional(),
        availability: z.enum(['available', 'maintenance']).default('available'),
      })
      .strict()
      .optional(),
    entryUrl: z.string().url(),
    skills: z.array(z.string().max(100)).max(50),
    resources: z
      .array(
        z.object({
          id: GameId,
          access: z.enum(['public', 'pro']),
          assets: z
            .array(z.object({ id: GameId, key: z.string().min(1).max(500) }))
            .max(50)
            .optional(),
        })
      )
      .min(1)
      .max(100),
  })
  .strict();
export type GameManifest = z.infer<typeof GameManifestSchema>;
export const SaveWriteSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    operationId: z.string().uuid(),
    schemaVersion: z.number().int().min(1).max(100000),
    payload: z.unknown(),
  })
  .strict()
  .refine(
    (x) =>
      x.payload !== undefined &&
      Buffer.byteLength(JSON.stringify(x.payload), 'utf8') <= 262144
  );
export type SaveWrite = z.infer<typeof SaveWriteSchema>;
export type GameSave = {
  revision: number;
  operationId: string;
  schemaVersion: number;
  payload: unknown;
};
export function advanceSave(
  current: GameSave | null,
  request: SaveWrite
): GameSave | null {
  if (current?.operationId === request.operationId) {
    return current.revision === request.baseRevision + 1 &&
      current.schemaVersion === request.schemaVersion &&
      JSON.stringify(current.payload) === JSON.stringify(request.payload)
      ? current
      : null;
  }
  if ((current?.revision ?? 0) !== request.baseRevision) return null;
  return {
    revision: request.baseRevision + 1,
    operationId: request.operationId,
    schemaVersion: request.schemaVersion,
    payload: request.payload,
  };
}
export interface GameStore {
  get(account: string, game: string, slot: string): Promise<GameSave | null>;
  put(
    account: string,
    game: string,
    slot: string,
    request: SaveWrite
  ): Promise<GameSave | null>;
  purge(account: string): Promise<void>;
}
export class InMemoryGameStore implements GameStore {
  private rows = new Map<string, GameSave>();
  async get(account: string, game: string, slot: string) {
    return structuredClone(
      this.rows.get(JSON.stringify([account, game, slot])) ?? null
    );
  }
  async put(account: string, game: string, slot: string, request: SaveWrite) {
    const key = JSON.stringify([account, game, slot]);
    const next = advanceSave(this.rows.get(key) ?? null, request);
    if (next) this.rows.set(key, structuredClone(next));
    return structuredClone(next);
  }
  async purge(account: string) {
    for (const key of this.rows.keys())
      if (JSON.parse(key)[0] === account) this.rows.delete(key);
  }
}
export function gameCatalog(): GameManifest[] {
  const games = z
    .array(GameManifestSchema)
    .max(50)
    .parse(JSON.parse(process.env.GAMES_CATALOG_JSON ?? '[]'));
  const ids = new Set<string>();
  for (const game of games) {
    const url = new URL(game.entryUrl);
    const local =
      ['localhost', '127.0.0.1'].includes(url.hostname) &&
      process.env.NODE_ENV !== 'production';
    if (
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username ||
      url.password ||
      url.hash ||
      ids.has(game.gameId)
    )
      throw new Error('Invalid game registry');
    ids.add(game.gameId);
    if (new Set(game.resources.map((r) => r.id)).size !== game.resources.length)
      throw new Error('Duplicate game resource');
    for (const resource of game.resources) {
      const assets = resource.assets ?? [];
      if (new Set(assets.map((asset) => asset.id)).size !== assets.length)
        throw new Error('Duplicate game asset');
    }
  }
  return games;
}
