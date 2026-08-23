import { Suspense, useEffect, useRef } from 'react';
import { NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useLearner } from '@/features/learner/store';
import { InstallPrompt } from '@/features/pwa/InstallPrompt';
import { UpdatePrompt } from '@/features/pwa/UpdatePrompt';
import { UpdateDialog } from '@/features/pwa/UpdateDialog';
import { markEngaged } from '@/features/pwa/update';
import { ErrorBoundary } from '@/shared/ui';

const NAV = [
  { to: '/', label: 'today', end: true, devOnly: false, tour: undefined },
  { to: '/grammar', label: 'grammar', end: false, devOnly: false, tour: undefined },
  { to: '/review', label: 'review', end: false, devOnly: false, tour: 'nav-review' },
  { to: '/progress', label: 'progress', end: false, devOnly: false, tour: undefined },
  { to: '/vocabulary', label: 'vocab', end: false, devOnly: false, tour: undefined },
  { to: '/library', label: 'library', end: false, devOnly: false, tour: 'nav-library' },
  { to: '/settings', label: 'settings', end: false, devOnly: false, tour: 'nav-settings' },
  { to: '/feedback', label: 'feedback', end: false, devOnly: false, tour: undefined },
  { to: '/support', label: 'support', end: false, devOnly: false, tour: undefined },
  { to: '/kitchen-sink', label: 'kit', end: false, devOnly: true, tour: undefined },
] as const;

export function AppLayout() {
  const level = useLearner((s) => s.level);
  const location = useLocation();
  // Once the user navigates away from the entry route, an update found later goes to the banner,
  // not the launch modal (see features/pwa/update.ts).
  const firstPath = useRef(location.pathname);
  useEffect(() => {
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
              title={level ? 'your level (from placement)' : 'course range'}
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
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <UpdateDialog />
      <UpdatePrompt />
      <InstallPrompt />

      <main
        className="mx-auto max-w-3xl px-5 py-8 pb-20"
        onPointerDownCapture={markEngaged}
        onKeyDownCapture={markEngaged}
      >
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<p className="font-mono text-sm text-muted">loading…</p>}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      {/* New paths open at the top; returning to a seen path restores its scroll. */}
      <ScrollRestoration getKey={(location) => location.pathname} />
    </div>
  );
}
