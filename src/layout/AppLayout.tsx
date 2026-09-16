import { Suspense, useEffect } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useLearner } from '@/features/learner/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { InstallPrompt } from '@/features/pwa/InstallPrompt';
import { metricaHit } from '@/features/analytics/metrica';
import { MigrationNotice } from '@/features/migration/MigrationNotice';
import { ErrorBoundary, PixelImage } from '@/shared/ui';
import { SELLER } from '@/shared/seller';
import { NavMore } from './NavMore';

/** `icon` defaults to the nav sprite named after `label.en`; set it when no such sprite exists. */
type NavItem = {
  to: string;
  label: { en: string; ru: string };
  end: boolean;
  devOnly: boolean;
  tour?: string;
  icon?: string;
};

/** The daily loop — always visible. Secondary destinations live behind "more" (NavMore), which keeps
 *  the header at two rows on a phone instead of four. */
const NAV: NavItem[] = [
  { to: '/', label: { en: 'today', ru: 'сегодня' }, end: true, devOnly: false, tour: undefined },
  { to: '/grammar', label: { en: 'grammar', ru: 'грамматика' }, end: false, devOnly: false, tour: undefined },
  { to: '/review', label: { en: 'review', ru: 'повторение' }, end: false, devOnly: false, tour: 'nav-review' },
  { to: '/vocabulary', label: { en: 'vocab', ru: 'словарь' }, end: false, devOnly: false, tour: undefined },
  { to: '/library', label: { en: 'library', ru: 'библиотека' }, end: false, devOnly: false, tour: 'nav-library' },
  { to: '/kitchen-sink', label: { en: 'kit', ru: 'kit' }, end: false, devOnly: true, tour: undefined },
];

const MORE: NavItem[] = [
  { to: '/progress', label: { en: 'progress', ru: 'прогресс' }, end: false, devOnly: false },
  { to: '/settings', label: { en: 'settings', ru: 'настройки' }, end: false, devOnly: false },
  { to: '/feedback', label: { en: 'feedback', ru: 'обратная связь' }, end: false, devOnly: false },
  { to: '/support', label: { en: 'support', ru: 'поддержка' }, end: false, devOnly: false },
  { to: '/about', label: { en: 'about', ru: 'о нас' }, end: false, devOnly: false, icon: '/assets/pixel/mascot.png' },
];

export function AppLayout() {
  const level = useLearner((s) => s.level);
  const ru = useUiLang((s) => s.lang) === 'ru';
  const location = useLocation();
  useEffect(() => {
    metricaHit(location.pathname);
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
          <nav className="relative flex flex-wrap items-center gap-1">
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
                <span className="flex items-center gap-1.5">
                  <PixelImage
                    src={item.icon ?? `/assets/pixel/nav/${item.label.en}.png`}
                    alt=""
                    className="h-4 w-4 shrink-0"
                  />
                  {ru ? item.label.ru : item.label.en}
                </span>
              </NavLink>
            ))}
            <NavMore
              label={ru ? 'ещё' : 'more'}
              items={MORE.map((item) => ({
                to: item.to,
                label: ru ? item.label.ru : item.label.en,
                icon: item.icon ?? `/assets/pixel/nav/${item.label.en}.png`,
              }))}
            />
          </nav>
        </div>
      </header>

      <MigrationNotice />
      <InstallPrompt />

      <main className="mx-auto max-w-3xl px-5 py-8 pb-20">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<p className="font-mono text-sm text-muted">{ru ? 'загрузка…' : 'loading…'}</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <SiteFooter ru={ru} />
      {/* New paths open at the top; returning to a seen path restores its scroll. */}
      <ScrollRestoration getKey={(location) => location.pathname} />
    </div>
  );
}

/**
 * Seller, contacts and the legal pages, on every screen.
 *
 * The acquirer's moderation reads the SITE, not the settings screen — before this the offer, the
 * privacy policy and the seller's details were reachable only from Settings and the paywall, which is
 * a poor place to look for them and, for a buyer deciding whether to pay, the wrong one.
 */
function SiteFooter({ ru }: { ru: boolean }) {
  const links = [
    { to: '/terms', ru: 'Условия и оферта', en: 'Terms and offer' },
    { to: '/privacy', ru: 'Конфиденциальность', en: 'Privacy' },
    { to: '/pro', ru: 'Подписка и цена', en: 'Subscription and price' },
    { to: '/support', ru: 'Поддержка', en: 'Support' },
  ];
  return (
    <footer className="mt-4 border-t border-line">
      <div className="mx-auto max-w-3xl px-5 py-6 font-mono text-2xs leading-relaxed text-muted">
        <nav className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className="hover:text-teal hover:underline">
              {ru ? l.ru : l.en}
            </NavLink>
          ))}
        </nav>
        <p>
          {SELLER.name}
          {ru ? ', самозанятый · ИНН ' : ', self-employed · INN '}
          {SELLER.inn}
        </p>
        <p className="mt-1">
          <a href={`mailto:${SELLER.email}`} className="hover:text-teal hover:underline">
            {SELLER.email}
          </a>
          <span className="px-2 text-faint">·</span>
          {SELLER.phone}
        </p>
      </div>
    </footer>
  );
}
