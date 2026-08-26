import { recordKeyLimits } from './limits';

export type AiProviderId =
  | 'zai'
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
  // Chinese providers: browser-CORS-friendly AND reachable from RU without a VPN (unlike Groq/
  // OpenRouter/Cerebras/Gemini/OpenAI, which geo-block RU). Z.AI's glm-4.5-flash is genuinely free,
  // no card. DeepSeek is cheap but its free grant isn't guaranteed — leave `noCard` off.
  zai: {
    label: 'Z.AI (GLM)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    model: 'glm-4.5-flash',
    browserSafe: true,
    noCard: true,
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
  },
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

export type ChatMessage = { role: 'system' | 'user'; content: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One OpenAI-compatible chat call with exponential backoff on 429/5xx. */
export async function complete(
  config: AiConfig,
  messages: ChatMessage[],
  opts: { temperature?: number; signal?: AbortSignal } = {}
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
