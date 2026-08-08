import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-lg border border-line bg-surface p-5', className)}
      {...props}
    />
  );
}
