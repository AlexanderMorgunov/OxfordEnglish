import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

type Segment<T extends string> = { value: T; label: ReactNode };

type SegmentedToggleProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  segments: Segment<T>[];
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
};

const SIZE = {
  sm: 'text-2xs px-2 py-1',
  md: 'text-xs px-2.5 py-1.5',
} as const;

/** Exclusive segmented control — e.g. the per-block EN/RU switch (DESIGN_DOC §5.2). */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  segments,
  ariaLabel,
  size = 'md',
  className,
}: SegmentedToggleProps<T>) {
  const move = (dir: 1 | -1) => {
    const i = segments.findIndex((s) => s.value === value);
    const next = segments[(i + dir + segments.length) % segments.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex gap-0.5 rounded-sm border border-line bg-ink p-0.5',
        className
      )}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {segments.map((seg) => {
        const active = seg.value === value;
        return (
          <button
            key={seg.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(seg.value)}
            className={cn(
              'rounded-[6px] font-mono uppercase tracking-[0.08em] transition-colors duration-150',
              SIZE[size],
              active
                ? 'bg-surface-2 text-teal'
                : 'text-muted hover:text-content'
            )}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
