import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'today', end: true },
  { to: '/review', label: 'review', end: false },
  { to: '/progress', label: 'progress', end: false },
  { to: '/vocabulary', label: 'vocab', end: false },
  { to: '/settings', label: 'settings', end: false },
  { to: '/kitchen-sink', label: 'kit', end: false },
] as const;

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <NavLink to="/" className="flex items-baseline gap-2">
            <span className="eyebrow">en/dev</span>
            <span className="font-mono text-sm text-muted">A2 → B1</span>
          </NavLink>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'font-mono text-xs rounded-sm px-2.5 py-1.5 transition-colors',
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
