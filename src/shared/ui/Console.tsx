import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type ConsoleStatus = 'pass' | 'fail' | 'neutral';

type ConsoleProps = HTMLAttributes<HTMLDivElement> & {
  status?: ConsoleStatus;
};

/** Test-runner feedback line — the app's signature element (DESIGN_DOC §8.1). */
export function Console({
  status = 'neutral',
  className,
  ...props
}: ConsoleProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'console',
        status === 'pass' && 'console--pass',
        status === 'fail' && 'console--fail',
        className
      )}
      {...props}
    />
  );
}
