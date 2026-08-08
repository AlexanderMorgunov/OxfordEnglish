import { cn } from '@/shared/lib/cn';

type ProgressBarProps = {
  value: number;
  max?: number;
  label?: string;
  showScore?: boolean;
  className?: string;
};

export function ProgressBar({
  value,
  max = 100,
  label = 'solved',
  showScore = true,
  className,
}: ProgressBarProps) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-md border border-line bg-surface p-4',
        className
      )}
    >
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-teal-dim to-teal transition-[width] duration-500 ease-[var(--ease-out-soft)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showScore && (
        <span className="whitespace-nowrap font-mono text-sm tabular-nums text-muted">
          <b className="text-teal">{value}</b> / {max} {label}
        </span>
      )}
    </div>
  );
}
