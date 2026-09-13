/**
 * Managed-AI domain: task specs, cache key derivation, and the cross-user cache boundary.
 *
 * The cache is deliberately ACCOUNT-FREE. A row keyed by prompt hash holding the completion is shared
 * content and safe; adding an accountId would turn it into a log of what each user read and asked —
 * a far heavier privacy object than anything in `entitlements`. Hit counts are unattributed.
 */
import { createHash } from 'node:crypto';
import type { AiTaskRequest, AiTaskName } from './contract.js';
import {
  clampBand,
  translateMessages,
  simplifyMessages,
  grammarMessages,
  wordInContextMessages,
  explainMessages,
  hintMessages,
  bookQaMessages,
  exercisesMessages,
  type ChatMessage,
} from './aiPrompts.js';

/**
 * Per-task pinned parameters. `version` is part of the cache key: bump it when the task's prompt changes
 * in aiPrompts.ts, or edited prompts keep serving pre-edit completions.
 *
 * `maxTokens` must leave room for any residual chain-of-thought PLUS the answer — a model that reasons
 * inside the cap returns empty `content` otherwise (the 512 on simplify/grammar exists for exactly that).
 */
type TaskSpec = {
  version: string;
  temperature: number;
  maxTokens: number;
  /** False where a fresh answer is the point, so a cache would be a bug rather than a saving. */
  cacheable: boolean;
};

export const TASKS: Record<AiTaskName, TaskSpec> = {
  translate: { version: 'v1', temperature: 0.2, maxTokens: 300, cacheable: true },
  simplify: { version: 'v1', temperature: 0.2, maxTokens: 512, cacheable: true },
  grammar: { version: 'v1', temperature: 0.3, maxTokens: 512, cacheable: true },
  wordInContext: { version: 'v1', temperature: 0.4, maxTokens: 220, cacheable: true },
  explain: { version: 'v1', temperature: 0.4, maxTokens: 220, cacheable: true },
  // A hint must react to the learner's CURRENT answer; re-asking after a change must not replay the
  // previous hint.
  hint: { version: 'v1', temperature: 0.4, maxTokens: 160, cacheable: false },
  // Questions vary per reader; the win here is the provider's own prefix cache on the page text.
  bookqa: { version: 'v1', temperature: 0.3, maxTokens: 600, cacheable: false },
  exercises: { version: 'v1', temperature: 0.4, maxTokens: 700, cacheable: true },
};

/** Every request costs the same whether or not the cache answers it. Charging zero for a hit would void
 *  the trial's one-time budget as an abuse bound: shared packs give a high hit rate precisely on the
 *  common path, so a farmed trial would draw unlimited completions. Revisit only by raising limits —
 *  the bound cannot be recovered once counters are issued against a free-hit rule. */
export const AI_COST_PER_CALL = 1;

export function buildMessages(req: AiTaskRequest): ChatMessage[] {
  switch (req.task) {
    case 'translate':
      return translateMessages(req.text.trim(), req.sentence?.trim());
    case 'simplify':
      return simplifyMessages(req.sentence.trim(), clampBand(req.level, req.stepDown ?? 0));
    case 'grammar':
      return grammarMessages(req.sentence.trim(), clampBand(req.level, 0));
    case 'wordInContext':
      return wordInContextMessages(req.word.trim(), req.sentence.trim());
    case 'explain':
      return explainMessages(req);
    case 'hint':
      return hintMessages(req);
    case 'bookqa':
      return bookQaMessages(req.pageText, req.question.trim());
    case 'exercises':
      return exercisesMessages({ text: req.text, targets: req.targets, count: req.count ?? 6 });
  }
}

/** Sum of the request's string inputs — what the input cap is measured against. The discriminator is
 *  not user input, so it doesn't count toward the cap. */
export function inputSize(req: AiTaskRequest): number {
  let n = 0;
  for (const [k, v] of Object.entries(req)) {
    if (k === 'task') continue;
    if (typeof v === 'string') n += v.length;
    else if (Array.isArray(v)) for (const s of v) if (typeof s === 'string') n += s.length;
  }
  return n;
}

/**
 * Cache key over the BUILT MESSAGES, not the raw request — so "identical prompt ⇒ identical key" holds by
 * construction. Keying on raw inputs instead would fragment the cache wherever a field is derived: a
 * learner on C1 and one on B2 both simplify at band B2 and send byte-identical prompts, but would have
 * missed each other's entries.
 *
 * Task and prompt version are folded in as well (a version bump must orphan old rows), and the model,
 * since swapping it changes the output. The account never is — see the module comment.
 */
export function cacheKey(req: AiTaskRequest, model: string): string {
  const spec = TASKS[req.task];
  const payload = JSON.stringify({ t: req.task, v: spec.version, m: model, msgs: buildMessages(req) });
  return createHash('sha256').update(payload).digest('base64url');
}

export interface AiCacheStore {
  get(key: string): Promise<string | null>;
  put(key: string, task: AiTaskName, content: string): Promise<void>;
}

export class InMemoryAiCacheStore implements AiCacheStore {
  private rows = new Map<string, string>();
  async get(key: string) {
    return this.rows.get(key) ?? null;
  }
  async put(key: string, _task: AiTaskName, content: string) {
    this.rows.set(key, content);
  }
}
