import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type ButtonVariant = 'primary' | 'ghost';
type ButtonSize = 'sm' | 'md';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-teal text-ink font-semibold hover:opacity-90',
  ghost: 'bg-ink text-content border border-line hover:border-teal-dim',
} as const;

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 text-xs',
  md: 'px-4 py-2.5 text-sm',
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-sm font-mono tracking-[0.02em]',
        'cursor-pointer transition-[opacity,border-color,scale] duration-150 active:scale-[0.96]',
        'disabled:cursor-default disabled:opacity-40 disabled:active:scale-100',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...props}
    />
  );
}
