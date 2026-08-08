import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type OptionState = 'default' | 'chosen' | 'correct' | 'wrong';

type OptionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  state?: OptionState;
};

/** Single answer choice for choice / spot-error exercises (DESIGN_DOC §8.4). */
export function Option({
  state = 'default',
  type = 'button',
  className,
  ...props
}: OptionProps) {
  return (
    <button
      type={type}
      className={cn(
        'opt text-left transition-[border-color,background-color] duration-150',
        'active:scale-[0.98] disabled:cursor-default disabled:active:scale-100',
        state === 'chosen' && 'opt--chosen',
        state === 'correct' && 'opt--correct',
        state === 'wrong' && 'opt--wrong',
        className
      )}
      {...props}
    />
  );
}
