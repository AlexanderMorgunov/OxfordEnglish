import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, Card, Eyebrow, Input, Option, PixelImage } from '@/shared/ui';
import { checkForAppUpdate } from '@/features/pwa/update';
import { getKeyLimits, subscribeKeyLimits } from '@/features/ai/limits';
import { PROVIDERS, type AiProviderId } from '@/features/ai/provider';
import { useAiStore } from '@/features/ai/store';
import { exportData, importData } from '@/features/progress/backup';
import { applySnapshot, type Snapshot } from '@/features/migration/snapshot';
import {
  analyticsConfigured,
  isAnalyticsEnabled,
  setAnalyticsEnabled,
} from '@/features/analytics/analytics';
import { metricaConfigured, initMetrica } from '@/features/analytics/metrica';
import { useLearner } from '@/features/learner/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { AccountSection } from '@/features/account/AccountSection';
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
  const { config, setConfig, forgetKey } = useAiStore();
  const [provider, setProvider] = useState<AiProviderId>(config?.provider ?? 'groq');
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [model, setModel] = useState(config?.model ?? PROVIDERS.groq.model);
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '');
  const [saved, setSaved] = useState(false);

  const { hash, search } = useLocation();
  // Where the user came from (e.g. a lesson that sent them here to add an AI key) — offer a way back.
  const from = new URLSearchParams(search).get('from');
  useEffect(() => {
    if (hash !== '#ai-section') return;
    const el = document.getElementById('ai-section');
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    requestAnimationFrame(() =>
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    );
  }, [hash]);

  const pick = (p: AiProviderId) => {
    const stored = useAiStore.getState().keys[p];
    setProvider(p);
    setApiKey(stored?.apiKey ?? '');
    setModel(stored?.model ?? PROVIDERS[p].model);
    setBaseUrl(stored?.baseUrl ?? '');
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
    forgetKey(provider);
    setApiKey('');
    setSaved(false);
  };

  const { level, placementDone, setLevel } = useLearner();
  const { lang, setLang } = useUiLang();
  const ru = lang === 'ru';

  const [analytics, setAnalytics] = useState(isAnalyticsEnabled());
  const toggleAnalytics = () => {
    const next = !analytics;
    setAnalyticsEnabled(next);
    setAnalytics(next);
    // Enabling loads Metrica now; disabling reloads so the already-loaded tag/cookies fully unload.
    if (next) initMetrica();
    else window.location.reload();
  };

  const keyLimits = useSyncExternalStore(subscribeKeyLimits, getKeyLimits, () => null);
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const doCheckUpdate = async () => {
    setChecking(true);
    setUpdateMsg('');
    const result = await checkForAppUpdate();
    setChecking(false);
    if (result === 'unavailable') {
      setUpdateMsg(
        ru ? '⚠ проверка недоступна (офлайн или SW не готов)' : '⚠ check unavailable (offline or SW not ready)'
      );
      return;
    }
    // A newly-found SW auto-activates and reloads the page; if we're still here, we're up to date.
    setUpdateMsg(ru ? '✓ установлена последняя версия' : '✓ you have the latest version');
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
      const text = await file.text();
      // A migration snapshot (from the .online → .ru file fallback) carries the full envelope incl.
      // settings; the legacy backup is a flat table dump. Route each to its importer.
      const parsed = JSON.parse(text) as { snapshotVersion?: number };
      if (typeof parsed.snapshotVersion === 'number') await applySnapshot(parsed as Snapshot);
      else await importData(text);
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
      {from && (
        <Link
          to={from}
          className="mb-6 inline-flex items-center font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
        >
          {from.includes('/course/')
            ? lang === 'ru'
              ? '← вернуться к уроку'
              : '← back to the lesson'
            : lang === 'ru'
              ? '← назад'
              : '← back'}
        </Link>
      )}
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

      <AccountSection />

      <div id="ai-section" className="scroll-mt-6" aria-hidden="true" />
      <Eyebrow className="mb-3.5">config · ai (byok)</Eyebrow>
      <div className="mb-2 flex items-center gap-3">
        <PixelImage src="/assets/pixel/ui/ai.png" alt="" className="h-7 w-7 shrink-0" />
        <h1 className="text-2xl font-bold tracking-tight">{ru ? 'AI-помощник' : 'AI assistant'}</h1>
      </div>
      <p className="mb-8 text-muted text-pretty">
        {ru
          ? 'Опционально. Приложение полностью работает и без него. Ключ хранится только в этом браузере, запросы идут напрямую к провайдеру — без нашего сервера.'
          : 'Optional. The app works fully without it. Your key is stored only in this browser and requests go straight to the provider — no server of ours.'}
      </p>

      <Card className="mb-4 border-violet-dim bg-violet-dim/15">
        <p className="mb-1 font-mono text-2xs uppercase tracking-[0.08em] text-violet">
          {ru ? 'перед тем как добавить ключ' : 'before you add a key'}
        </p>
        <p className="text-sm leading-relaxed text-pretty">
          {ru ? (
            <>
              На бесплатных тарифах запросы часто идут в обучение моделей провайдера — для учебных фраз
              обычно ок, но знайте. <b className="text-content">Из России без VPN:</b>{' '}
              Groq/OpenRouter/Cerebras/Gemini/OpenAI гео-блокируют РФ (нужен VPN). Без VPN работает{' '}
              <b className="text-content">VseGPT</b> — RU-прокси (OpenAI-совместимый, 120+ моделей):
              платный по рублёвой карте, но с небольшим бесплатным кредитом на старте (без карты) — можно
              попробовать. Свой AI без ключа — в планах.
            </>
          ) : (
            <>
              Free tiers usually mean your requests may train the provider's models — fine for learning
              sentences, but know it. <b className="text-content">From Russia without a VPN:</b>{' '}
              Groq/OpenRouter/Cerebras/Gemini/OpenAI geo-block RU (need a VPN). Without a VPN,{' '}
              <b className="text-content">VseGPT</b> works — a RU proxy (OpenAI-compatible, 120+ models):
              paid by ruble card, but with a small no-card starter credit to try. A key-free managed AI is
              planned.
            </>
          )}
        </p>
      </Card>

      <div className="mb-4">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'провайдер' : 'provider'}
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
                <span className="ml-2 text-2xs text-teal">{ru ? 'без карты' : 'no card'}</span>
              )}
              {PROVIDERS[id].needsVpn && id !== 'custom' && (
                <span className="ml-2 text-2xs text-amber">{ru ? 'нужен VPN' : 'VPN'}</span>
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
            {ru ? 'получить бесплатный ключ →' : 'get a free key →'}
          </a>
        )}
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            {ru ? 'api-ключ' : 'api key'}
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
            {ru ? 'модель' : 'model'}
            {model !== PROVIDERS[provider].model && PROVIDERS[provider].model && (
              <button
                type="button"
                className="text-teal hover:underline"
                onClick={() => setModel(PROVIDERS[provider].model)}
              >
                {ru ? 'сбросить на' : 'reset to'} {PROVIDERS[provider].model}
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
          {ru ? 'Сохранить ключ' : 'Save key'}
        </Button>
        {apiKey.trim() !== '' && (
          <Button variant="ghost" onClick={clear}>
            {ru ? 'Удалить ключ' : 'Remove key'}
          </Button>
        )}
        {saved && <span className="font-mono text-2xs text-teal">{ru ? '✓ сохранено' : '✓ saved'}</span>}
      </div>

      {keyLimits && (
        <div className="mt-4 rounded-sm border border-line bg-surface-2/50 p-3">
          <p className="mb-1.5 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            {ru ? 'лимиты ключа · по последнему запросу' : 'key limits · from the last request'}
          </p>
          <ul className="space-y-0.5 font-mono text-2xs text-content">
            {keyLimits.remainingRequests !== undefined && (
              <li>
                {ru ? 'запросов' : 'requests'}: {keyLimits.remainingRequests}
                {keyLimits.limitRequests !== undefined ? ` / ${keyLimits.limitRequests}` : ''}
                {keyLimits.resetRequests ? ` · ${ru ? 'сброс' : 'reset'} ${keyLimits.resetRequests}` : ''}
              </li>
            )}
            {keyLimits.remainingTokens !== undefined && (
              <li>
                {ru ? 'токенов' : 'tokens'}: {keyLimits.remainingTokens}
                {keyLimits.limitTokens !== undefined ? ` / ${keyLimits.limitTokens}` : ''}
                {keyLimits.resetTokens ? ` · ${ru ? 'сброс' : 'reset'} ${keyLimits.resetTokens}` : ''}
              </li>
            )}
          </ul>
          <p className="mt-1.5 text-2xs text-faint text-pretty">
            {ru
              ? 'Лимиты общие для всего ключа (перевод, объяснения и т. п.) и обновляются после каждого AI-запроса.'
              : 'Limits are shared across the whole key (translation, explanations, etc.) and refresh after each AI request.'}
          </p>
        </div>
      )}

      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'ваш уровень' : 'your level'}
        </p>
        <p className="mb-4 text-sm text-muted text-pretty">
          {placementDone
            ? ru
              ? 'Задан тестом на уровень. Измените здесь или пройдите тест заново.'
              : 'Set by the placement test. Change it here or retake the test.'
            : ru
              ? 'Ещё не задан. Пройдите тест на уровень или выберите, с какого начать.'
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
          {placementDone
            ? ru
              ? 'пройти тест заново →'
              : 'retake placement test →'
            : ru
              ? 'пройти тест на уровень →'
              : 'take placement test →'}
        </Link>
      </div>

      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'ваши данные' : 'your data'}
        </p>
        <p className="mb-4 text-sm text-muted text-pretty">
          {ru
            ? 'Прогресс, карточки повторения и статусы слов живут только в этом браузере. Сделайте резервную копию или перенесите на другое устройство.'
            : 'Progress, SRS cards and word status live only in this browser. Export a backup or move it to another device.'}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => void doExport()}>
            {ru ? 'Экспорт JSON' : 'Export JSON'}
          </Button>
          <label className="cursor-pointer rounded-sm border border-line bg-ink px-4 py-2.5 font-mono text-sm text-content transition-colors hover:border-teal-dim">
            {ru ? 'Импорт JSON' : 'Import JSON'}
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
        {analyticsConfigured() || metricaConfigured() ? (
          <>
            <p className="mb-4 text-sm text-muted text-pretty">
              Собираем обезличенную статистику посещений через Яндекс Метрику (какие
              экраны открывают, устройства, регионы) — чтобы понимать, помогает ли
              приложение учиться. Метрика ставит cookies и использует IP-адрес.
              Содержимое ваших занятий не передаётся. Можно выключить в любой момент.
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

      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'обновления приложения' : 'app updates'}
        </p>
        <p className="mb-4 text-sm text-muted text-pretty">
          {ru
            ? 'Приложение обновляется само при выходе новой версии. Если оно «застряло» на старой (частая ситуация с установленным PWA), проверьте и примените обновление вручную.'
            : 'The app updates itself when a new version ships. If it seems stuck on an old one (common with an installed PWA), check and apply an update manually.'}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => void doCheckUpdate()} disabled={checking}>
            {checking
              ? ru
                ? 'Проверяю…'
                : 'Checking…'
              : ru
                ? 'Проверить обновления'
                : 'Check for updates'}
          </Button>
          {updateMsg && <span className="font-mono text-2xs text-teal">{updateMsg}</span>}
        </div>
        <p className="mt-3 font-mono text-2xs text-faint">version: {__APP_VERSION__}</p>
      </div>
    </section>
  );
}
