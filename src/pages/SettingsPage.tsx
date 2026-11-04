import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { ApplicationTextSize } from '@/features/appearance/ApplicationTextSize';
import { AppearanceThemes } from '@/features/appearance/ThemePicker';
import { AccountSection } from '@/features/account/AccountSection';
import { accountsEnabled } from '@/features/account/config';
import { useAccount } from '@/features/account/store';
import {
  getDataOwnerRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { safeSettingsReturn } from '@/features/settings/navigation';
import { useCourseNavigation } from '@/features/course/navigation';
import { AiSettings } from '@/features/settings/AiSettings';
import { DataSettings } from '@/features/settings/DataSettings';
import { PrivacySettings } from '@/features/settings/PrivacySettings';
import type { Level } from '@/content/schema';
import '@/features/settings/settings.css';

const SECTIONS = [
  {
    id: 'interface',
    ru: 'Интерфейс',
    en: 'Appearance',
    noteRu: 'Тема, размер текста и язык',
    noteEn: 'Theme, text size and language',
    descriptionRu: 'Сделайте DayEnglish удобным именно для вас.',
    descriptionEn: 'Make DayEnglish comfortable for you.',
    icon: '/assets/pixel/nav/settings.png',
  },
  {
    id: 'learning',
    ru: 'Обучение',
    en: 'Learning',
    noteRu: 'Уровень и точка старта',
    noteEn: 'Level and starting point',
    descriptionRu: 'Выберите, откуда продолжить знакомство с языком.',
    descriptionEn: 'Choose where to continue learning.',
    icon: '/assets/pixel/nav/grammar.png',
  },
  {
    id: 'ai',
    ru: 'AI-помощник',
    en: 'AI assistant',
    noteRu: 'Доступ и свой провайдер',
    noteEn: 'Access and your own provider',
    descriptionRu: 'Перевод и объяснения — когда нужна помощь.',
    descriptionEn: 'Translations and explanations when you need help.',
    icon: '/assets/pixel/ui/ai.png',
  },
  {
    id: 'account',
    ru: 'Аккаунт и подписка',
    en: 'Account and plan',
    noteRu: 'Pro, вход и устройства',
    noteEn: 'Pro, sign-in and devices',
    descriptionRu: 'Ваш доступ к DayEnglish на всех устройствах.',
    descriptionEn: 'Your access to DayEnglish on every device.',
    icon: '/assets/pixel/avatars/a01.png',
  },
  {
    id: 'data',
    ru: 'Данные и синхронизация',
    en: 'Data and sync',
    noteRu: 'Облачная и резервная копия',
    noteEn: 'Cloud sync and backups',
    descriptionRu: 'Держите прогресс под рукой, а резервную копию — у себя.',
    descriptionEn: 'Keep your progress close and a backup of your own.',
    icon: '/assets/pixel/nav/library.png',
  },
  {
    id: 'privacy',
    ru: 'Приватность и приложение',
    en: 'Privacy and app',
    noteRu: 'Статистика, версия и документы',
    noteEn: 'Analytics, version and documents',
    descriptionRu: 'Что приложение отправляет и как его обновлять.',
    descriptionEn: 'What the app sends and how to keep it up to date.',
    icon: '/assets/pixel/nav/support.png',
  },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];
const isSection = (value: unknown): value is SectionId =>
  SECTIONS.some((s) => s.id === value);
const LEVEL_START: Partial<Record<Level, string>> = {
  A1: 'u00',
  A2: 'u01',
  B1: 'u15',
};

export function SettingsPage() {
  const revision = useSyncExternalStore(
    subscribeDataScope,
    getDataOwnerRevision
  );
  return <SettingsContent key={revision} />;
}

function SettingsContent() {
  const { lang, setLang } = useUiLang();
  const ru = lang === 'ru';
  const { level, placementDone, setLevel } = useLearner();
  const session = useAccount((s) => s.sessionRevision);
  const location = useLocation();
  const { section: routeSection } = useParams();
  const legacy =
    location.hash === '#ai-section'
      ? 'ai'
      : location.hash === '#account'
        ? 'account'
        : null;
  const explicit = isSection(routeSection) ? routeSection : legacy;
  const section = explicit ?? 'interface';
  const meta = SECTIONS.find((s) => s.id === section)!;
  const [compact, setCompact] = useState(
    () => !window.matchMedia('(min-width: 900px)').matches
  );
  const index = compact && !explicit;
  const heading = useRef<HTMLHeadingElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const focusRoute = useRef<string | null>(null);
  const params = new URLSearchParams(location.search);
  const from = safeSettingsReturn(params.get('from'));
  const work = useCourseNavigation((s) => s.work);
  const workUnit = work?.dayId.match(/^(u\d+)\./)?.[1];
  const returnTo =
    from ??
    (work && workUnit
      ? `/course/${workUnit}/day/${encodeURIComponent(work.dayId)}`
      : '/');
  const href = (id?: SectionId) =>
    `/settings${id ? `/${id}` : ''}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
  const [languageError, setLanguageError] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const change = () => setCompact(!media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useLayoutEffect(() => {
    const entering = focusRoute.current !== location.key;
    focusRoute.current = location.key;
    if (document.querySelector('.app-dialog[open]')) return;
    if (
      !entering &&
      document.activeElement?.closest('.app-header,.app-nav-bottom')
    )
      return;
    (index ? title : heading).current?.focus({ preventScroll: true });
  }, [section, index, location.key]);

  return (
    <section
      className={`settings-shell ${index ? 'settings-mobile-index' : 'settings-mobile-detail'}`}
      aria-label={ru ? 'Настройки' : 'Settings'}
    >
      <header className="settings-top">
        <Link className="settings-back" to={returnTo}>
          ←{' '}
          {from && !from.includes('/course/')
            ? ru
              ? 'Назад'
              : 'Back'
            : ru
              ? 'Вернуться к занятию'
              : 'Back to learning'}
        </Link>
        <h1 ref={title} tabIndex={-1}>
          {ru ? 'Настройки' : 'Settings'}
        </h1>
        <p>
          {ru ? 'Меньше лишнего. Больше вашего.' : 'Less clutter. More you.'}
        </p>
      </header>
      <div className="settings-frame">
        <nav
          className="settings-menu"
          aria-label={ru ? 'Разделы настроек' : 'Settings sections'}
        >
          {SECTIONS.map((s) => (
            <Link
              key={s.id}
              to={href(s.id)}
              className="settings-link"
              aria-current={!index && section === s.id ? 'page' : undefined}
            >
              <PixelImage src={s.icon} alt="" className="settings-icon" />
              <span>
                {s[ru ? 'ru' : 'en']}
                <span className="settings-link-summary">
                  {s[ru ? 'noteRu' : 'noteEn']}
                </span>
              </span>
              <span className="settings-link-arrow" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
          <p className="settings-menu-note">
            {ru
              ? 'Учебный путь остаётся на месте. Можно вернуться к своему дню в любой момент.'
              : 'Your learning path stays in place. Return to your day whenever you like.'}
          </p>
        </nav>
        <section
          className="settings-panel"
          aria-labelledby="settings-section-title"
        >
          <Link className="settings-back settings-mobile-back" to={href()}>
            ← {ru ? 'Все настройки' : 'All settings'}
          </Link>
          <header className="settings-panel-header">
            <h2 id="settings-section-title" tabIndex={-1} ref={heading}>
              {meta[ru ? 'ru' : 'en']}
            </h2>
            <p>{meta[ru ? 'descriptionRu' : 'descriptionEn']}</p>
          </header>
          <div hidden={section !== 'interface'}>
            {section === 'interface' && !index && (
              <AppearanceThemes placement="settings" />
            )}
            <div className="settings-group">
              <div className="settings-pad">
                <ApplicationTextSize />
              </div>
              <div className="settings-row">
                <div>
                  <label htmlFor="settings-language">
                    {ru ? 'Язык интерфейса' : 'Interface language'}
                  </label>
                  <p>
                    {ru
                      ? 'Подсказки и инструкции. Учебные материалы останутся на английском.'
                      : 'Hints and instructions. Course material stays in English.'}
                  </p>
                </div>
                <select
                  id="settings-language"
                  className="settings-control"
                  value={lang}
                  onChange={(e) => {
                    setLanguageError(
                      !setLang(e.target.value === 'en' ? 'en' : 'ru')
                    );
                  }}
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>
            {languageError && (
              <p role="status" className="settings-error">
                {ru
                  ? 'Язык изменён для этого сеанса, но сохранить его не удалось.'
                  : 'Language changed for this session, but could not be saved.'}
              </p>
            )}
          </div>
          <div hidden={section !== 'learning'}>
            <div className="settings-group">
              <div className="settings-row">
                <div>
                  <label htmlFor="settings-level">
                    {ru ? 'Мой уровень' : 'My level'}
                  </label>
                  <p>
                    {ru
                      ? 'Задаёт рекомендуемую точку старта. Пройденные дни и результаты сохраняются.'
                      : 'Sets your recommended starting point. Completed days and results are kept.'}
                  </p>
                </div>
                <select
                  id="settings-level"
                  className="settings-control"
                  value={level ?? ''}
                  onChange={(e) => {
                    const value = e.target.value as Level;
                    const start = LEVEL_START[value];
                    if (start) setLevel(value, start);
                  }}
                >
                  <option value="" disabled>
                    {ru ? 'Не выбран' : 'Not selected'}
                  </option>
                  {level && !LEVEL_START[level] && (
                    <option value={level}>{level}</option>
                  )}
                  {(['A1', 'A2', 'B1'] as const).map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <div>
                  <h3>
                    {ru ? 'Не уверены в уровне?' : 'Not sure about your level?'}
                  </h3>
                  <p>
                    {ru
                      ? 'Короткий тест поможет выбрать подходящую точку старта.'
                      : 'A short test helps you find a starting point.'}
                  </p>
                </div>
                <Link className="settings-text-link" to="/placement">
                  {placementDone
                    ? ru
                      ? 'Пройти тест заново →'
                      : 'Retake the test →'
                    : ru
                      ? 'Определить уровень →'
                      : 'Find my level →'}
                </Link>
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-row">
                <div>
                  <h3>{ru ? 'Ваш текущий день' : 'Your current day'}</h3>
                  <p>
                    {ru
                      ? 'Настройки не начинают день заново. Вернитесь к своему занятию.'
                      : 'Settings do not restart your day. Return to your lesson.'}
                  </p>
                </div>
                <Link className="settings-text-link" to={returnTo}>
                  {ru ? 'Вернуться к занятию →' : 'Back to learning →'}
                </Link>
              </div>
            </div>
          </div>
          <div hidden={section !== 'ai'}>
            <AiSettings key={session} />
          </div>
          <div
            hidden={section !== 'account'}
            className="settings-group settings-pad"
          >
            {accountsEnabled() ? (
              <AccountSection />
            ) : (
              <p className="settings-help">
                {ru
                  ? 'Аккаунты недоступны в этой сборке. Локальные занятия и резервные копии продолжают работать.'
                  : 'Accounts are unavailable in this build. Local learning and backups still work.'}
              </p>
            )}
          </div>
          <div hidden={section !== 'data'}>
            <DataSettings
              key={session}
              accountHref={href('account')}
              active={section === 'data' && !index}
            />
          </div>
          <div hidden={section !== 'privacy'}>
            <PrivacySettings />
          </div>
        </section>
      </div>
    </section>
  );
}
