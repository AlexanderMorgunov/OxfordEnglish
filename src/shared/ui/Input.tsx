import type { InputHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, spellCheck = false, ...props }: InputProps) {
  return (
    <input
      spellCheck={spellCheck}
      autoComplete="off"
      className={cn(
        'w-full rounded-sm border border-line bg-ink px-3 py-2.5 font-mono text-base text-content',
        'transition-colors duration-150 placeholder:text-faint focus:border-teal',
        className
      )}
      {...props}
    />
  );
}
