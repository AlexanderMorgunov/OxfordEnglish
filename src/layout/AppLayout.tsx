import { Suspense, useEffect, useRef } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useLearner } from '@/features/learner/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { InstallPrompt } from '@/features/pwa/InstallPrompt';
import { UpdatePrompt } from '@/features/pwa/UpdatePrompt';
import { UpdateDialog } from '@/features/pwa/UpdateDialog';
import { markEngaged } from '@/features/pwa/update';
import { metricaHit } from '@/features/analytics/metrica';
import { MigrationNotice } from '@/features/migration/MigrationNotice';
import { ErrorBoundary } from '@/shared/ui';

const NAV = [
  { to: '/', label: { en: 'today', ru: 'сегодня' }, end: true, devOnly: false, tour: undefined },
  { to: '/grammar', label: { en: 'grammar', ru: 'грамматика' }, end: false, devOnly: false, tour: undefined },
  { to: '/review', label: { en: 'review', ru: 'повторение' }, end: false, devOnly: false, tour: 'nav-review' },
  { to: '/progress', label: { en: 'progress', ru: 'прогресс' }, end: false, devOnly: false, tour: undefined },
  { to: '/vocabulary', label: { en: 'vocab', ru: 'словарь' }, end: false, devOnly: false, tour: undefined },
  { to: '/library', label: { en: 'library', ru: 'библиотека' }, end: false, devOnly: false, tour: 'nav-library' },
  { to: '/settings', label: { en: 'settings', ru: 'настройки' }, end: false, devOnly: false, tour: 'nav-settings' },
  { to: '/feedback', label: { en: 'feedback', ru: 'отзыв' }, end: false, devOnly: false, tour: undefined },
  { to: '/support', label: { en: 'support', ru: 'поддержка' }, end: false, devOnly: false, tour: undefined },
  { to: '/kitchen-sink', label: { en: 'kit', ru: 'kit' }, end: false, devOnly: true, tour: undefined },
] as const;

export function AppLayout() {
  const level = useLearner((s) => s.level);
  const ru = useUiLang((s) => s.lang) === 'ru';
  const location = useLocation();
  // Once the user navigates away from the entry route, an update found later goes to the banner,
  // not the launch modal (see features/pwa/update.ts).
  const firstPath = useRef(location.pathname);
  useEffect(() => {
    metricaHit(location.pathname);
    if (location.pathname !== firstPath.current) markEngaged();
  }, [location.pathname]);
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
          <NavLink to="/" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="eyebrow">en/dev</span>
            <span
              className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-teal"
              title={
                level
                  ? ru
                    ? 'ваш уровень (по тесту)'
                    : 'your level (from placement)'
                  : ru
                    ? 'диапазон курса'
                    : 'course range'
              }
            >
              {level ?? 'A1–A2'}
            </span>
          </NavLink>
          <nav className="flex flex-wrap items-center gap-1">
            {NAV.filter((item) => !item.devOnly || import.meta.env.DEV).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                data-tour={item.tour}
                className={({ isActive }) =>
                  [
                    'font-mono text-xs rounded-sm px-2.5 py-1.5 transition-colors',
                    item.devOnly ? 'hidden sm:inline-block' : '',
                    isActive
                      ? 'bg-surface-2 text-teal'
                      : 'text-muted hover:text-content',
                  ].join(' ')
                }
              >
                {ru ? item.label.ru : item.label.en}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <UpdateDialog />
      <MigrationNotice />
      <UpdatePrompt />
      <InstallPrompt />

      <main
        className="mx-auto max-w-3xl px-5 py-8 pb-20"
        onPointerDownCapture={markEngaged}
        onKeyDownCapture={markEngaged}
      >
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<p className="font-mono text-sm text-muted">{ru ? 'загрузка…' : 'loading…'}</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      {/* New paths open at the top; returning to a seen path restores its scroll. */}
      <ScrollRestoration getKey={(location) => location.pathname} />
    </div>
  );
}
