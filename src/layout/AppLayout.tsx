import { NavLink, Outlet } from 'react-router-dom';
import { useLearner } from '@/features/learner/store';

const NAV = [
  { to: '/', label: 'today', end: true, devOnly: false },
  { to: '/grammar', label: 'grammar', end: false, devOnly: false },
  { to: '/review', label: 'review', end: false, devOnly: false },
  { to: '/progress', label: 'progress', end: false, devOnly: false },
  { to: '/vocabulary', label: 'vocab', end: false, devOnly: false },
  { to: '/settings', label: 'settings', end: false, devOnly: false },
  { to: '/kitchen-sink', label: 'kit', end: false, devOnly: true },
] as const;

export function AppLayout() {
  const level = useLearner((s) => s.level);
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
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
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

      <main className="mx-auto max-w-3xl px-5 py-8 pb-20">
        <Outlet />
      </main>
    </div>
  );
}
