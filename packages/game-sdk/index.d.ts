export type GameContext = {
  gameId: string;
  releaseId: string;
  locale: 'ru' | 'en';
  reducedMotion: boolean;
  capabilities: string[];
  view?: { expanded: boolean };
};
export type Save = {
  revision: number;
  schemaVersion: number;
  payload: unknown;
  operationId: string;
};
export type GameMethods = {
  'view.set': {
    input: { expanded: boolean };
    output: { expanded: boolean };
  };
  'save.load': { input: { slotId: string }; output: Save | null };
  'save.write': {
    input: {
      slotId: string;
      baseRevision: number;
      operationId: string;
      schemaVersion: number;
      payload: unknown;
    };
    output: { revision: number; status: 'local_saved' };
  };
  'save.cloud': {
    input: { slotId: string; direction: 'push' | 'pull' };
    output: { revision: number; status: 'synced' | 'empty' };
  };
  'save.resolve': {
    input: { slotId: string };
    output:
      | { status: 'cancelled' }
      | { status: 'synced'; revision: number; backupSlotId: string };
  };
  'content.access': {
    input: { resourceId: string };
    output: {
      allowed: boolean;
      reason: 'public' | 'pro' | 'no_plan';
      expiresAt?: number;
    };
  };
  'content.asset': {
    input: { resourceId: string; assetId: string };
    output: { url: string; expiresAt: number };
  };
  'vocabulary.capture': {
    input: { term: string; translation: string; context?: string };
    output: { status: 'saved' | 'existing' | 'cancelled' };
  };
  'translation.open': {
    input: { text: string; context?: string };
    output: { text: string | null; status: 'translated' | 'cancelled' };
  };
  'learning.report': {
    input: {
      eventId: string;
      activityId: string;
      itemVersion: string;
      runId: string;
      attemptNumber: number;
      skills: string[];
      correct: boolean;
      usedHint: boolean;
      usedAI: boolean;
    };
    output: { status: 'recorded' | 'existing' };
  };
};
export class GameError extends Error {
  code: string;
  constructor(code: string);
}
export function connectDayEnglish(options: {
  hostOrigin: string;
  gameId: string;
  releaseId: string;
  timeoutMs?: number;
}): {
  ready: Promise<GameContext>;
  request<K extends keyof GameMethods>(
    method: K,
    payload: GameMethods[K]['input'],
    options?: { timeoutMs?: number }
  ): Promise<GameMethods[K]['output']>;
  onEvent(
    listener: (
      event:
        | { type: 'paused' | 'resumed' | 'closed' }
        | { type: 'view.changed'; expanded: boolean }
    ) => void
  ): () => void;
  close(): void;
};
