import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { Button, Input, PixelImage } from '@/shared/ui';
import { PROVIDERS } from '@/features/ai/provider';
import type { AiProviderId } from '@/features/ai/provider';
import { useAiStore } from '@/features/ai/store';
import { getKeyLimits, subscribeKeyLimits } from '@/features/ai/limits';
import { useAccount } from '@/features/account/store';
import {
  hasManagedAi,
  planLine,
  quotaNotice,
  subscriptionState,
  useEntitlement,
} from '@/features/account/entitlement';

type Draft = { apiKey: string; model: string; baseUrl: string };
function savedDraft(provider: AiProviderId): Draft {
  const { config, keys } = useAiStore.getState();
  const saved = config?.provider === provider ? config : keys[provider];
  return {
    apiKey: saved?.apiKey ?? '',
    model: saved?.model ?? PROVIDERS[provider].model,
    baseUrl: saved?.baseUrl ?? '',
  };
}
export function AiSettings() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const config = useAiStore((s) => s.config);
  const keys = useAiStore((s) => s.keys);
  const [provider, setProvider] = useState<AiProviderId>(
    config?.provider ?? 'groq'
  );
  const [drafts, setDrafts] = useState<Partial<Record<AiProviderId, Draft>>>(
    {}
  );
  const draft = drafts[provider] ?? savedDraft(provider);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>(
    {}
  );
  const [message, setMessage] = useState<
    'saved' | 'removed' | 'storage' | null
  >(null);
  const [removing, setRemoving] = useState(false);
  const limits = useSyncExternalStore(
    subscribeKeyLimits,
    getKeyLimits,
    () => null
  );
  const signedIn = useAccount((s) => s.status) === 'authenticated';
  const entitlement = useEntitlement((s) => s.entitlement);
  const loading = useEntitlement((s) => s.loading);
  const state = subscriptionState(entitlement, Date.now());
  const managed =
    (state === 'pro' || state === 'trial') && hasManagedAi(entitlement);
  const notice = quotaNotice(entitlement, ru);
  const update = (field: keyof Draft, value: string) => {
    setDrafts((s) => ({ ...s, [provider]: { ...draft, [field]: value } }));
    setErrors((s) => ({ ...s, [field]: undefined }));
    setMessage(null);
    setRemoving(false);
  };
  const save = () => {
    const next: typeof errors = {};
    if (!draft.apiKey.trim())
      next.apiKey = ru ? 'Введите ключ провайдера.' : 'Enter a provider key.';
    if (!draft.model.trim())
      next.model = ru ? 'Укажите модель.' : 'Enter a model.';
    if (provider === 'custom') {
      try {
        const url = new URL(draft.baseUrl.trim());
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error('url');
      } catch {
        next.baseUrl = ru
          ? 'Нужен HTTPS-адрес API без пароля, параметров и #, например https://example.com/v1.'
          : 'Use an HTTPS API URL without credentials, query or #, e.g. https://example.com/v1.';
      }
    }
    setErrors(next);
    setMessage(null);
    const first = (Object.keys(next) as (keyof Draft)[])[0];
    if (first) {
      document.getElementById(`settings-ai-${first}`)?.focus();
      return;
    }
    const ok = useAiStore.getState().setConfig({
      provider,
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      baseUrl: provider === 'custom' ? draft.baseUrl.trim() : undefined,
    });
    setMessage(ok ? 'saved' : 'storage');
    if (ok) setDrafts((s) => ({ ...s, [provider]: savedDraft(provider) }));
  };
  const remove = () => {
    const ok = useAiStore.getState().forgetKey(provider);
    setMessage(ok ? 'removed' : 'storage');
    if (ok) {
      setDrafts((s) => ({ ...s, [provider]: savedDraft(provider) }));
      setRemoving(false);
    }
  };
  return (
    <>
      <div className="settings-group settings-ai-access">
        <PixelImage
          src="/assets/pixel/ui/ai.png"
          alt=""
          className="h-10 w-10 shrink-0"
        />
        <div>
          <h3>{ru ? 'AI от DayEnglish' : 'DayEnglish AI'}</h3>
          <p>
            {managed
              ? ru
                ? 'Доступен с вашей подпиской. Ничего настраивать не нужно.'
                : 'Available with your plan. No setup needed.'
              : signedIn && !entitlement
                ? loading
                  ? ru
                    ? 'Проверяем доступ…'
                    : 'Checking access…'
                  : ru
                    ? 'Не удалось проверить доступ. Повторите при подключении к сети.'
                    : 'Could not check access. Retry when connected.'
                : ru
                  ? 'Контекстный перевод и объяснения входят в Pro. Для них не нужен свой API-ключ.'
                  : 'Contextual translations and explanations are included in Pro. No personal API key is needed.'}
          </p>
          {signedIn && entitlement && (
            <p className="settings-tag">{planLine(entitlement, state, ru)}</p>
          )}
          {notice && <p role="status">{notice.text}</p>}
          {signedIn && !entitlement ? (
            <Button
              variant="ghost"
              disabled={loading}
              onClick={() => void useEntitlement.getState().load()}
            >
              {ru ? 'Проверить доступ' : 'Check access'}
            </Button>
          ) : (
            <Link className="settings-text-link" to="/pro">
              {managed
                ? ru
                  ? 'Управлять подпиской'
                  : 'Manage plan'
                : ru
                  ? 'Посмотреть Pro'
                  : 'Explore Pro'}{' '}
              →
            </Link>
          )}
        </div>
      </div>
      <details className="settings-group settings-disclosure">
        <summary>
          {ru ? 'Подключить свой AI' : 'Connect your own AI'}
          <span>
            {ru
              ? 'Необязательно · для тех, у кого есть ключ провайдера'
              : 'Optional · if you have a provider key'}
          </span>
        </summary>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          noValidate
        >
          <p className="settings-help">
            {ru
              ? 'Ключ хранится на этом устройстве. Запросы с ним отправляются напрямую выбранному провайдеру; его условия и тарифы действуют отдельно.'
              : 'Your key is stored on this device. Requests go directly to your chosen provider under its own terms and pricing.'}
          </p>
          {config && (
            <p className="settings-help">
              {ru ? 'Сейчас подключён: ' : 'Connected: '}
              {PROVIDERS[config.provider].label}
            </p>
          )}
          <label htmlFor="settings-ai-provider">
            {ru ? 'Провайдер' : 'Provider'}
          </label>
          <select
            id="settings-ai-provider"
            className="settings-control"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as AiProviderId);
              setErrors({});
              setMessage(null);
              setRemoving(false);
            }}
          >
            {(Object.keys(PROVIDERS) as AiProviderId[]).map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].label}
              </option>
            ))}
          </select>
          {PROVIDERS[provider].keyUrl && (
            <a
              className="settings-text-link"
              href={PROVIDERS[provider].keyUrl}
              target="_blank"
              rel="noreferrer"
            >
              {ru ? 'Ключ и условия провайдера ↗' : 'Provider key and terms ↗'}
            </a>
          )}
          {(
            [
              'apiKey',
              'model',
              ...(provider === 'custom' ? ['baseUrl' as const] : []),
            ] as const
          ).map((field) => (
            <div key={field} className="settings-field">
              <label htmlFor={`settings-ai-${field}`}>
                {field === 'apiKey'
                  ? ru
                    ? 'API-ключ'
                    : 'API key'
                  : field === 'model'
                    ? ru
                      ? 'Модель'
                      : 'Model'
                    : 'Base URL'}
              </label>
              <Input
                id={`settings-ai-${field}`}
                type={
                  field === 'apiKey'
                    ? 'password'
                    : field === 'baseUrl'
                      ? 'url'
                      : 'text'
                }
                autoComplete="off"
                spellCheck={false}
                value={draft[field]}
                aria-invalid={!!errors[field]}
                aria-describedby={
                  errors[field] ? `settings-ai-${field}-error` : undefined
                }
                onChange={(e) => update(field, e.target.value)}
              />
              {errors[field] && (
                <p id={`settings-ai-${field}-error`} className="settings-error">
                  {errors[field]}
                </p>
              )}
            </div>
          ))}
          <div className="settings-actions">
            <Button type="submit">{ru ? 'Сохранить ключ' : 'Save key'}</Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDrafts((s) => ({ ...s, [provider]: savedDraft(provider) }));
                setErrors({});
                setMessage(null);
                setRemoving(false);
              }}
            >
              {ru ? 'Отменить изменения' : 'Cancel changes'}
            </Button>
          </div>
          {(!!keys[provider] || config?.provider === provider) && !removing && (
            <button
              className="settings-text-link settings-danger"
              type="button"
              onClick={() => {
                setRemoving(true);
                setMessage(null);
              }}
            >
              {ru
                ? 'Удалить ключ этого провайдера'
                : 'Remove this provider key'}
            </button>
          )}
          {removing && (
            <div className="settings-confirm">
              <p>
                {ru
                  ? 'Удалить сохранённый ключ? Ключи других провайдеров останутся.'
                  : 'Remove the saved key? Other provider keys will remain.'}
              </p>
              <div className="settings-actions">
                <Button variant="ghost" onClick={() => setRemoving(false)}>
                  {ru ? 'Отмена' : 'Cancel'}
                </Button>
                <Button variant="ghost" onClick={remove}>
                  {ru ? 'Удалить ключ' : 'Remove key'}
                </Button>
              </div>
            </div>
          )}
          <p
            role="status"
            className={
              message === 'storage' ? 'settings-error' : 'settings-feedback'
            }
          >
            {message === 'saved'
              ? ru
                ? 'Ключ сохранён. Подключение проверится при первом AI-запросе.'
                : 'Key saved. The connection will be checked on your first AI request.'
              : message === 'removed'
                ? ru
                  ? 'Ключ удалён.'
                  : 'Key removed.'
                : message === 'storage'
                  ? ru
                    ? 'Не удалось сохранить изменения на устройстве. Введённые данные остаются в форме — попробуйте ещё раз.'
                    : 'Could not save changes on this device. Your input is still here — please retry.'
                  : ''}
          </p>
          {limits && config?.provider === provider && (
            <p className="settings-help">
              {ru
                ? 'Лимиты по последнему запросу: '
                : 'Limits from the last request: '}
              {limits.remainingRequests != null &&
                `${limits.remainingRequests} ${ru ? 'запросов' : 'requests'} `}
              {limits.remainingTokens != null &&
                `${limits.remainingTokens} ${ru ? 'токенов' : 'tokens'}`}
            </p>
          )}
        </form>
      </details>
    </>
  );
}
