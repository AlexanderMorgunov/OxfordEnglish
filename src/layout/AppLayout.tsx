import { Suspense, useEffect, useRef } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { InstallPrompt } from '@/features/pwa/InstallPrompt';
import { metricaHit } from '@/features/analytics/metrica';
import { MigrationNotice } from '@/features/migration/MigrationNotice';
import { ErrorBoundary } from '@/shared/ui';
import { SELLER } from '@/shared/seller';
import { AppHeader } from './AppHeader';
import { BackToTop } from './BackToTop';
import '@/features/appearance/store';
import '@/features/appearance/themes';
import { ProActivationDialog } from '@/features/account/ProActivationDialog';

export function AppLayout() {
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    metricaHit(location.pathname);
  }, [location.pathname]);
  return (
    <div className="min-h-screen">
      <AppHeader />

      <MigrationNotice />
      <InstallPrompt />

      <main ref={mainRef} tabIndex={-1} className="app-container py-8 pb-20 [overflow-wrap:break-word]">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<p className="font-mono text-sm text-muted">{ru ? 'загрузка…' : 'loading…'}</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <SiteFooter ru={ru} />
      <ProActivationDialog />
      <BackToTop key={location.pathname} pathname={location.pathname} mainRef={mainRef} />
      {/* New paths open at the top; returning to a seen path restores its scroll. */}
      <ScrollRestoration getKey={(location) => location.pathname === '/' || location.pathname === '/syllabus' ? location.pathname + location.search : location.pathname.startsWith('/grammar') || location.pathname === '/progress' ? location.key : location.pathname} />
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
    { to: '/terms', ru: 'Оферта и контакты', en: 'Offer and contacts' },
    { to: '/privacy', ru: 'Конфиденциальность', en: 'Privacy' },
    { to: '/pro', ru: 'Подписка и цена', en: 'Subscription and price' },
    { to: '/support', ru: 'Поддержка', en: 'Support' },
  ];
  return (
    <footer data-app-footer className="mt-4 border-t border-line">
      <div className="app-container py-4 text-xs leading-relaxed text-muted [overflow-wrap:anywhere]">
        <nav className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className="hover:text-teal hover:underline">
              {ru ? l.ru : l.en}
            </NavLink>
          ))}
        </nav>
        <p className="text-2xs">
          {SELLER.name}
          {ru ? ', самозанятый · ИНН ' : ', self-employed · INN '}
          {SELLER.inn}
        </p>
      </div>
    </footer>
  );
}
