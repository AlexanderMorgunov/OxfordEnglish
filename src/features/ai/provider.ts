import { recordKeyLimits } from './limits';

export type AiProviderId =
  | 'vsegpt'
  | 'deepseek'
  | 'groq'
  | 'openrouter'
  | 'cerebras'
  | 'gemini'
  | 'openai'
  | 'custom';

export type AiConfig = {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

type Preset = {
  label: string;
  baseUrl: string;
  model: string;
  browserSafe: boolean;
  noCard: boolean;
  /** From Russia, signing up / getting a key typically needs a VPN. Region access drifts —
   *  keep the label soft. Only the clear cases are flagged. */
  needsVpn?: boolean;
  keyUrl?: string;
};

export const PROVIDERS: Record<AiProviderId, Preset> = {
  // RU OpenAI-compatible proxy: reachable from Russia WITHOUT a VPN. Paid (ruble card) with a small
  // no-card starter credit; proxies 120+ models — pick any in the model field.
  vsegpt: {
    label: 'VseGPT',
    baseUrl: 'https://api.vsegpt.ru/v1',
    model: 'openai/gpt-4o-mini',
    browserSafe: true,
    noCard: false,
    keyUrl: 'https://vsegpt.ru/',
  },
  // DeepSeek's own OpenAI-compatible API. Reachable from Russia without a VPN and verified to send CORS
  // (ACAO echoes the origin) on the actual POST, so it works from the browser. Paid (top up a balance);
  // cheap. `deepseek-v4-flash` is the fast/cheap default (the account may also expose `deepseek-v4-pro`).
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    browserSafe: true,
    noCard: false,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    // llama-3.3-70b-versatile reached end-of-life 2026-08-16; gpt-oss is the successor.
    model: 'openai/gpt-oss-20b',
    browserSafe: true,
    noCard: true,
    // Groq geo-blocks Russia — a VPN is needed both to create a key and to call the API.
    needsVpn: true,
    keyUrl: 'https://console.groq.com/keys',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-oss-20b:free',
    browserSafe: true,
    noCard: true,
    needsVpn: true,
    keyUrl: 'https://openrouter.ai/keys',
  },
  cerebras: {
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    // Cerebras uses the bare id (no "openai/" prefix, unlike Groq/OpenRouter).
    model: 'gpt-oss-120b',
    browserSafe: true,
    noCard: true,
    needsVpn: true,
    keyUrl: 'https://cloud.cerebras.ai',
  },
  gemini: {
    label: 'Google AI Studio (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    browserSafe: true,
    noCard: false,
    needsVpn: true,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    browserSafe: false,
    noCard: false,
    needsVpn: true,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    model: '',
    browserSafe: true,
    noCard: true,
  },
};

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Provider-specific body params that turn OFF a model's chain-of-thought. Our reader micro-tasks (a
 *  one-sentence rewrite/translate) never want reasoning: it's slow and bills thousands of tokens per tap
 *  (`deepseek-v4-flash` reasons by default — the ~1¢/sentence, 48k-token bug). Sent ONLY for providers
 *  known to accept it — an unknown field 400s elsewhere (DeepSeek itself rejects `reasoning_effort:none`). */
function reasoningOffParams(provider: AiProviderId): Record<string, unknown> {
  switch (provider) {
    case 'deepseek':
      return { thinking: { type: 'disabled' } }; // rejects reasoning_effort:none
    case 'groq':
      return { reasoning_effort: 'low' }; // gpt-oss on Groq can't turn reasoning OFF (rejects 'none'); 'low' = min
    case 'cerebras':
      return { reasoning_effort: 'low' }; // cerebras gpt-oss: 'low' | 'medium' | 'high' (no 'none'), like Groq
    case 'gemini':
      return { reasoning_effort: 'none' }; // Gemini 2.5 OpenAI-compat: 'none' disables thinking
    case 'openrouter':
      return { reasoning: { enabled: false } };
    // deepseek/gemini verified live; groq verified live; cerebras/openrouter by-docs (not yet live-tested —
    // their default models are gpt-oss reasoning models, so leaving this off shows the empty-output symptom).
    default:
      return {};
  }
}

/** One OpenAI-compatible chat call with exponential backoff on 429/5xx. `maxTokens` HARD-caps the
 *  completion; `noReasoning` disables the model's chain-of-thought where the provider supports it. Always
 *  set both for short outputs, or a reasoning model runs to its default ceiling (thousands of tokens). */
export async function complete(
  config: AiConfig,
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; noReasoning?: boolean; signal?: AbortSignal } = {}
): Promise<string> {
  const baseUrl = (config.baseUrl || PROVIDERS[config.provider].baseUrl).replace(/\/$/, '');
  if (!baseUrl) throw new Error('No base URL configured for the AI provider.');

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: opts.temperature ?? 0.4,
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        ...(opts.noReasoning ? reasoningOffParams(config.provider) : {}),
      }),
      signal: opts.signal,
    });

    recordKeyLimits(res.headers, config.provider);

    if (res.status === 429 || res.status >= 500) {
      await sleep(2 ** attempt * 1200);
      continue;
    }
    if (!res.ok) {
      throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('Empty AI response.');
    return content;
  }
  throw new Error('AI request failed after retries (rate limited).');
}
