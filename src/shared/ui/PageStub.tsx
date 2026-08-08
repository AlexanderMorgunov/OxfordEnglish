import type { ReactNode } from 'react';

type PageStubProps = {
  eyebrow: string;
  title: string;
  children?: ReactNode;
};

/** Milestone-M0 placeholder screen. Replaced per-screen in later milestones. */
export function PageStub({ eyebrow, title, children }: PageStubProps) {
  return (
    <section aria-label={title}>
      <p className="eyebrow mb-3.5">{eyebrow}</p>
      <h1 className="mb-3 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="max-w-prose text-muted">
        {children ?? 'Screen skeleton — implemented in a later milestone.'}
      </p>
    </section>
  );
}
