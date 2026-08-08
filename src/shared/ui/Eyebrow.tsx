import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type EyebrowProps = HTMLAttributes<HTMLParagraphElement>;

export function Eyebrow({ className, ...props }: EyebrowProps) {
  return <p className={cn('eyebrow', className)} {...props} />;
}
