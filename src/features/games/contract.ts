import { z } from 'zod';

export const CHANNEL = 'dayenglish.game';
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
export const GameManifestSchema = z
  .object({
    gameId: id.refine((value) => value.toLowerCase() !== 'submit'),
    releaseId: id,
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
      .array(z.object({ id, access: z.enum(['public', 'pro']) }))
      .min(1)
      .max(100),
  })
  .strict();
export type GameManifest = z.infer<typeof GameManifestSchema>;
export const CaptureSchema = z
  .object({
    term: z.string().trim().min(1).max(240),
    translation: z.string().max(500),
    context: z.string().max(1000).default(''),
  })
  .strict();
export const TranslationSchema = z
  .object({
    text: z.string().trim().min(1).max(1000),
    context: z.string().max(1000).default(''),
  })
  .strict();
export const LearningSchema = z
  .object({
    eventId: z.string().uuid(),
    activityId: id,
    itemVersion: id,
    runId: id,
    attemptNumber: z.number().int().min(1).max(10000),
    skills: z.array(z.string().max(100)).min(1).max(10),
    correct: z.boolean(),
    usedHint: z.boolean(),
    usedAI: z.boolean(),
  })
  .strict();
export type Learning = z.infer<typeof LearningSchema>;
export const SlotSchema = z
  .object({ slotId: z.string().regex(/^[0-7]$/) })
  .strict();
export const SaveWriteSchema = SlotSchema.extend({
  baseRevision: z.number().int().nonnegative(),
  operationId: z.string().uuid(),
  schemaVersion: z.number().int().min(1).max(100000),
  payload: z.unknown(),
}).refine(
  (x) =>
    x.payload !== undefined &&
    new TextEncoder().encode(JSON.stringify(x.payload)).length <= 262144
);
export type SaveWrite = z.infer<typeof SaveWriteSchema>;
export const CloudSchema = SlotSchema.extend({
  direction: z.enum(['push', 'pull']),
});
export const AccessSchema = z.object({ resourceId: id }).strict();
export const AssetSchema = AccessSchema.extend({ assetId: id });
export const WindowSchema = z.object({ expanded: z.boolean() }).strict();
export const RequestSchema = z
  .object({
    channel: z.literal(CHANNEL),
    version: z.literal(1),
    type: z.literal('request'),
    launchId: z.string().uuid(),
    requestId: z.string().uuid(),
    method: z.enum([
      'save.load',
      'save.write',
      'save.cloud',
      'save.resolve',
      'content.access',
      'content.asset',
      'vocabulary.capture',
      'translation.open',
      'learning.report',
      'view.set',
    ]),
    payload: z.unknown(),
  })
  .strict();
export type GameRequest = z.infer<typeof RequestSchema>;
export class GameFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export const capabilities = [
  'save.local.v1',
  'save.cloud.v1',
  'content.access.v1',
  'vocabulary.capture.v1',
  'translation.v1',
  'learning.report.v1',
  'activity.v1',
  'view.window.v1',
];
