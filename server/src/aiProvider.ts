/**
 * The managed AI upstream. Pinned to DeepSeek's OpenAI-compatible API with OUR key from Lockbox
 * (`DEEPSEEK_API_KEY`) — the key exists only here and never reaches a client. BYOK users keep calling
 * their provider straight from the browser; this path is the paid plan's "works out of the box".
 *
 * Model, temperature, token ceiling and reasoning-off are all server-decided. Reasoning in particular
 * MUST stay off: deepseek-v4-flash reasons by default, which on a one-sentence rewrite bills thousands
 * of tokens (the client's provider.ts records this as the ~1¢/sentence, 48k-token bug). A client-
 * controllable flag would let a paid account re-trigger that on our balance.
 */
import type { ChatMessage } from './aiPrompts.js';

const BASE_URL = (process.env.AI_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');

export const AI_MODEL = process.env.AI_MODEL ?? 'deepseek-v4-flash';

export function aiConfigured(): boolean {
  return !!process.env.DEEPSEEK_API_KEY;
}

export type CompleteOpts = {
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  /** Only for the usage log — the upstream never sees it. */
  task?: string;
};
export type Completer = (messages: ChatMessage[], opts: CompleteOpts) => Promise<string>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AiUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiUpstreamError';
  }
}

export const deepseekCompleter: Completer = async (messages, opts) => {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new AiUpstreamError('DEEPSEEK_API_KEY is not set');

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        // DeepSeek rejects `reasoning_effort: none`; this is the form it accepts.
        thinking: { type: 'disabled' },
      }),
      signal: opts.signal,
    });

    if (res.status === 429 || res.status >= 500) {
      // Shorter than the client's backoff on purpose: this runs inside a request the user is waiting on,
      // and the container has a 30 s ceiling.
      await sleep(2 ** attempt * 600);
      continue;
    }
    if (!res.ok) throw new AiUpstreamError(`upstream ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new AiUpstreamError('empty completion');
    // Token counts only — never the prompt or the answer. This is what turns the provisional
    // TRIAL_AI_REQUESTS / PRO_AI_REQUESTS into measured numbers; it is also why it carries no account id.
    const u = data.usage;
    if (u) {
      // eslint-disable-next-line no-console
      console.log(
        `[ai-usage] task=${opts.task ?? '?'} model=${AI_MODEL} prompt=${u.prompt_tokens ?? 0} ` +
          `completion=${u.completion_tokens ?? 0} prefix_cached=${u.prompt_cache_hit_tokens ?? 0}`
      );
    }
    return content;
  }
  throw new AiUpstreamError('upstream rate-limited after retries');
};
