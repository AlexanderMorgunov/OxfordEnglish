import { useState } from 'react';
import { Button, Card, Eyebrow, Input, Option } from '@/shared/ui';
import { PROVIDERS, type AiProviderId } from '@/features/ai/provider';
import { isConfigured, useAiStore } from '@/features/ai/store';

const PROVIDER_IDS = Object.keys(PROVIDERS) as AiProviderId[];

export function SettingsPage() {
  const { config, setConfig } = useAiStore();
  const [provider, setProvider] = useState<AiProviderId>(config?.provider ?? 'gemini');
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [model, setModel] = useState(config?.model ?? PROVIDERS.gemini.model);
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [saved, setSaved] = useState(false);

  const pick = (p: AiProviderId) => {
    setProvider(p);
    setModel(PROVIDERS[p].model);
    setBaseUrl('');
    setSaved(false);
  };

  const save = () => {
    setConfig({
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
      baseUrl: baseUrl.trim() || undefined,
    });
    setSaved(true);
  };

  const clear = () => {
    setConfig(null);
    setApiKey('');
    setSaved(false);
  };

  return (
    <section aria-label="Settings" className="max-w-prose">
      <Eyebrow className="mb-3.5">config · ai (byok)</Eyebrow>
      <h1 className="mb-2 text-2xl font-bold tracking-tight">AI assistant</h1>
      <p className="mb-8 text-muted text-pretty">
        Optional. The app works fully without it. Your key is stored only in this
        browser and requests go straight to the provider — no server of ours.
      </p>

      <Card className="mb-4 border-violet-dim bg-violet-dim/15">
        <p className="mb-1 font-mono text-2xs uppercase tracking-[0.08em] text-violet">
          before you add a key
        </p>
        <p className="text-sm leading-relaxed text-pretty">
          Free tiers almost always mean your requests may be used to train the
          provider's models. For learning sentences that's usually fine — but you
          should know. Prefer a browser-friendly provider (Gemini, Groq,
          OpenRouter); OpenAI blocks direct browser calls (CORS).
        </p>
      </Card>

      <div className="mb-4">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          provider
        </p>
        <div className="flex flex-wrap gap-2">
          {PROVIDER_IDS.map((id) => (
            <Option
              key={id}
              state={provider === id ? 'chosen' : 'default'}
              onClick={() => pick(id)}
            >
              {PROVIDERS[id].label}
            </Option>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            api key
          </span>
          <Input
            type="password"
            placeholder="sk-…"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            model
          </span>
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        {provider === 'custom' && (
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
              base url
            </span>
            <Input
              placeholder="https://…/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!apiKey.trim() || !model.trim()}>
          Save key
        </Button>
        {isConfigured(config) && (
          <Button variant="ghost" onClick={clear}>
            Remove key
          </Button>
        )}
        {saved && <span className="font-mono text-2xs text-teal">✓ saved</span>}
      </div>
    </section>
  );
}
