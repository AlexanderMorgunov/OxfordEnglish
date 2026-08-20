import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Eyebrow, Input, Option } from '@/shared/ui';
import { PROVIDERS, type AiProviderId } from '@/features/ai/provider';
import { isConfigured, useAiStore } from '@/features/ai/store';
import { exportData, importData } from '@/features/progress/backup';
import {
  analyticsConfigured,
  isAnalyticsEnabled,
  setAnalyticsEnabled,
} from '@/features/analytics/analytics';
import { useLearner } from '@/features/learner/store';
import { useUiLang } from '@/features/i18n/uiLang';
import type { Level } from '@/content/schema';

const PROVIDER_IDS = Object.keys(PROVIDERS) as AiProviderId[];

const LEVEL_START: Record<Level, string> = {
  A1: 'u00',
  A2: 'u01',
  B1: 'u15',
  B2: 'u15',
  C1: 'u15',
  C2: 'u15',
};
const LEVELS: Level[] = ['A1', 'A2', 'B1'];

export function SettingsPage() {
  const { config, setConfig } = useAiStore();
  const [provider, setProvider] = useState<AiProviderId>(config?.provider ?? 'groq');
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [model, setModel] = useState(config?.model ?? PROVIDERS.groq.model);
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

  const { level, placementDone, setLevel } = useLearner();
  const { lang, setLang } = useUiLang();

  const [analytics, setAnalytics] = useState(isAnalyticsEnabled());
  const toggleAnalytics = () => {
    const next = !analytics;
    setAnalyticsEnabled(next);
    setAnalytics(next);
  };

  const [dataMsg, setDataMsg] = useState('');
  const doExport = async () => {
    const blob = new Blob([await exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oxford-progress.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  const doImport = async (file: File) => {
    try {
      await importData(await file.text());
      setDataMsg(lang === 'ru' ? '✓ импортировано — перезагрузите страницу' : '✓ imported — reload to see it');
    } catch {
      setDataMsg(
        lang === 'ru'
          ? '✕ не удалось прочитать файл — выберите файл резервной копии (.json)'
          : '✕ could not read the file — pick a backup (.json) file'
      );
    }
  };

  return (
    <section aria-label="Settings" className="max-w-prose">
      <div className="mb-10 border-b border-line pb-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          язык интерфейса · interface language
        </p>
        <p className="mb-3 text-sm text-muted text-pretty">
          Язык инструкций, подсказок и объяснений. Английский учебный текст не
          меняется. / Language of instructions, hints and explanations.
        </p>
        <div className="flex gap-2">
          {(['ru', 'en'] as const).map((l) => (
            <Option
              key={l}
              state={lang === l ? 'chosen' : 'default'}
              onClick={() => setLang(l)}
            >
              {l === 'ru' ? 'Русский' : 'English'}
            </Option>
          ))}
        </div>
      </div>

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
          should know. <b className="text-content">No card needed:</b> Groq,
          OpenRouter, Cerebras. Gemini now asks for a card, and OpenAI blocks
          direct browser calls (CORS).
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
              {PROVIDERS[id].noCard && id !== 'custom' && (
                <span className="ml-2 text-2xs text-teal">no card</span>
              )}
            </Option>
          ))}
        </div>
        {PROVIDERS[provider].keyUrl && (
          <a
            href={PROVIDERS[provider].keyUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
          >
            get a free key →
          </a>
        )}
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
          <span className="flex items-center justify-between font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            model
            {model !== PROVIDERS[provider].model && PROVIDERS[provider].model && (
              <button
                type="button"
                className="text-teal hover:underline"
                onClick={() => setModel(PROVIDERS[provider].model)}
              >
                ↺ сбросить на {PROVIDERS[provider].model}
              </button>
            )}
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

      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          your level
        </p>
        <p className="mb-4 text-sm text-muted text-pretty">
          {placementDone
            ? 'Set by the placement test. Change it here or retake the test.'
            : 'Not set yet. Take the placement test, or choose a level to start from.'}
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          {LEVELS.map((lv) => (
            <Option
              key={lv}
              state={level === lv ? 'chosen' : 'default'}
              onClick={() => setLevel(lv, LEVEL_START[lv])}
            >
              {lv}
            </Option>
          ))}
        </div>
        <Link
          to="/placement"
          className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
        >
          {placementDone ? 'retake placement test →' : 'take placement test →'}
        </Link>
      </div>

      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          your data
        </p>
        <p className="mb-4 text-sm text-muted text-pretty">
          Progress, SRS cards and word status live only in this browser. Export a
          backup or move it to another device.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => void doExport()}>
            Export JSON
          </Button>
          <label className="cursor-pointer rounded-sm border border-line bg-ink px-4 py-2.5 font-mono text-sm text-content transition-colors hover:border-teal-dim">
            Import JSON
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void doImport(file);
              }}
            />
          </label>
          {dataMsg && <span className="font-mono text-2xs text-teal">{dataMsg}</span>}
        </div>
      </div>

      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          анонимная статистика · anonymous usage
        </p>
        {analyticsConfigured() ? (
          <>
            <p className="mb-4 text-sm text-muted text-pretty">
              Полностью анонимные, обезличенные события использования (например:
              открытие приложения, завершённый день, открытие книги, установка
              приложения) — чтобы понимать, помогает ли приложение учиться. Без
              личных данных, без содержимого. Можно выключить в любой момент.
            </p>
            <Option state={analytics ? 'chosen' : 'default'} onClick={toggleAnalytics}>
              {analytics ? 'Включена' : 'Выключена'}
            </Option>
          </>
        ) : (
          <p className="text-sm text-muted text-pretty">
            Сейчас ничего не собирается и не отправляется — сервер статистики не
            подключён. Приложение работает полностью локально.
          </p>
        )}
      </div>
    </section>
  );
}
