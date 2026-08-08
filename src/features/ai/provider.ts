export type AiProviderId = 'gemini' | 'groq' | 'openrouter' | 'openai' | 'custom';

export type AiConfig = {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

type Preset = { label: string; baseUrl: string; model: string; browserSafe: boolean };

export const PROVIDERS: Record<AiProviderId, Preset> = {
  gemini: {
    label: 'Google AI Studio (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    browserSafe: true,
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    browserSafe: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    browserSafe: true,
  },
  openai: {
    label: 'OpenAI (may need a proxy — CORS)',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    browserSafe: false,
  },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '', model: '', browserSafe: true },
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
