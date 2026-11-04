import { Suspense, useEffect, useRef } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { InstallPrompt } from '@/features/pwa/InstallPrompt';
import { metricaHit } from '@/features/analytics/metrica';
import { MigrationNotice } from '@/features/migration/MigrationNotice';
import { ErrorBoundary } from '@/shared/ui';
import { SELLER } from '@/shared/seller';
import { AppHeader } from './AppHeader';
import { NavigationFocus } from './NavigationFocus';
import { BackToTop } from './BackToTop';
import '@/features/appearance/store';
import '@/features/appearance/themes';
import { ProActivationDialog } from '@/features/account/ProActivationDialog';
import { AccountAccessNotice } from '@/features/account/AccountAccessNotice';
import { ContextualOnboarding } from '@/features/onboarding/ContextualOnboarding';
import { FirstEntryWelcome } from '@/features/welcome/FirstEntryWelcome';
import { SalePromotion } from '@/features/sale/SalePromotion';
import { RecoveryNavigationGuard } from '@/features/account/RecoveryNavigationGuard';

export function AppLayout() {
  return <RecoveryNavigationGuard><AppLayoutContent /></RecoveryNavigationGuard>;
}

function AppLayoutContent() {
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    metricaHit(location.pathname);
  }, [location.pathname]);
  return (
    <div className="app-shell min-h-screen">
      <a
        href="#app-main"
        className="app-skip-link"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus({ preventScroll: true });
          mainRef.current?.scrollIntoView({ block: 'start' });
        }}
      >
        {ru ? 'К содержимому' : 'Skip to content'}
      </a>
      <AppHeader />
      <NavigationFocus />

      <MigrationNotice />
      <InstallPrompt />

      <main
        id="app-main"
        ref={mainRef}
        tabIndex={-1}
        className="app-main app-container py-8 pb-20 [overflow-wrap:break-word]"
      >
        <SalePromotion />
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<p className="font-mono text-sm text-muted">{ru ? 'загрузка…' : 'loading…'}</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <SiteFooter ru={ru} />
      <ProActivationDialog />
      <AccountAccessNotice />
      <FirstEntryWelcome />
      <ContextualOnboarding />
      <BackToTop key={location.pathname} pathname={location.pathname} mainRef={mainRef} />
      {/* New paths open at the top; returning to a seen path restores its scroll. */}
      <ScrollRestoration getKey={(location) => location.pathname === '/' || location.pathname === '/syllabus' ? location.pathname + location.search : location.pathname.startsWith('/grammar') || location.pathname === '/progress' || location.pathname === '/about' ? location.key : location.pathname} />
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
