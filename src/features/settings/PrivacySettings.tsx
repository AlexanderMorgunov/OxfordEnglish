import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  analyticsConfigured,
  isAnalyticsEnabled,
  setAnalyticsEnabled,
} from '@/features/analytics/analytics';
import { initMetrica, metricaConfigured } from '@/features/analytics/metrica';
import { checkForAppUpdate } from '@/features/pwa/update';
import { isNativePlatform } from '@/shared/lib/platform';

export function PrivacySettings() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [analytics, setAnalytics] = useState(() => {
    try {
      return isAnalyticsEnabled();
    } catch {
      return false;
    }
  });
  const [analyticsError, setAnalyticsError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<'current' | 'unavailable' | null>(null);
  const native = isNativePlatform();
  const configured = analyticsConfigured() || metricaConfigured();
  const toggle = () => {
    try {
      setAnalyticsEnabled(!analytics);
      setAnalytics(!analytics);
      setAnalyticsError(false);
      if (!analytics) initMetrica();
      else window.location.reload();
    } catch {
      setAnalyticsError(true);
    }
  };
  const check = async () => {
    setChecking(true);
    setUpdate(null);
    try {
      setUpdate(
        (await checkForAppUpdate()) === 'unavailable'
          ? 'unavailable'
          : 'current'
      );
    } catch {
      setUpdate('unavailable');
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <h3 id="settings-analytics-label">
              {ru ? 'Помогать улучшать DayEnglish' : 'Help improve DayEnglish'}
            </h3>
            <p id="settings-analytics-help">
              {configured
                ? ru
                  ? 'Яндекс Метрика собирает статистику использования, cookies и IP-адрес. Содержимое ваших занятий не передаётся. При отключении страница обновится.'
                  : 'Yandex Metrica collects usage statistics, cookies and IP addresses. Your study content is not sent. Turning this off reloads the page.'
                : ru
                  ? 'Статистика использования в этой сборке не подключена.'
                  : 'Usage analytics is not connected in this build.'}
            </p>
          </div>
          <input
            className="settings-switch"
            type="checkbox"
            role="switch"
            aria-labelledby="settings-analytics-label"
            aria-describedby="settings-analytics-help"
            checked={configured && analytics}
            disabled={!configured}
            onChange={toggle}
          />
        </div>
        {analyticsError && (
          <p role="alert" className="settings-error settings-pad">
            {ru
              ? 'Не удалось сохранить выбор. Повторите.'
              : 'Could not save your choice. Please retry.'}
          </p>
        )}
      </div>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <h3>{ru ? 'Версия приложения' : 'App version'}</h3>
            <p className="break-all">
              {native ? 'Android' : ru ? 'Веб-приложение' : 'Web app'} ·{' '}
              {__APP_VERSION__}
            </p>
            <p>
              {native
                ? ru
                  ? 'Обновления устанавливаются вместе с новой версией приложения из магазина.'
                  : 'Updates are installed with the new app version from the store.'
                : ru
                  ? 'Обновления устанавливаются автоматически. Можно проверить наличие новой версии вручную.'
                  : 'Updates install automatically. You can also check for a new version.'}
            </p>
          </div>
          {!native && (
            <Button
              variant="ghost"
              disabled={checking}
              onClick={() => void check()}
            >
              {checking
                ? ru
                  ? 'Проверяем…'
                  : 'Checking…'
                : ru
                  ? 'Проверить обновления'
                  : 'Check for updates'}
            </Button>
          )}
        </div>
        {update && (
          <p role="status" className="settings-pad settings-feedback">
            {update === 'current'
              ? ru
                ? 'Установлена последняя версия.'
                : 'You have the latest version.'
              : ru
                ? 'Проверка сейчас недоступна. Проверьте соединение и повторите позже.'
                : 'Update check is unavailable. Check your connection and retry later.'}
          </p>
        )}
      </div>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <h3>{ru ? 'DayEnglish в соцсетях' : 'DayEnglish on social media'}</h3>
            <p>{ru ? 'Полезные фразы, задания и новости проекта.' : 'Useful phrases, activities and project news.'}</p>
            <Link className="settings-text-link" to="/about#community">
              {ru ? 'Выбрать Telegram или ВКонтакте' : 'Choose Telegram or VK'} →
            </Link>
          </div>
        </div>
        {(
          [
            ['/privacy', ru ? 'Политика конфиденциальности' : 'Privacy policy'],
            ['/terms', ru ? 'Условия использования' : 'Terms of use'],
          ] as const
        ).map(([to, title]) => (
          <div className="settings-row" key={to}>
            <Link className="settings-text-link" to={to}>
              {title} →
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
