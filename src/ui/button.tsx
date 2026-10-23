import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Show } from 'meemaw';

import { Loader2 } from '@icons';

import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'md' | 'lg' | 'sm';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

// Deck pills: solid brand, or white with the ink stroke.
const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white border-2 border-brand hover:bg-brand-strong hover:border-brand-strong disabled:opacity-50',
  secondary: 'bg-white text-ink border-2 border-ink hover:bg-surface-2 disabled:opacity-50',
  ghost: 'bg-transparent text-ink border-2 border-transparent hover:bg-surface-2',
  danger: 'bg-red text-white border-2 border-red hover:opacity-90',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-[15px]',
  lg: 'h-13 px-6 text-base',
};

export function Button({ variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, ...rest }: Readonly<Props>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors select-none disabled:cursor-not-allowed',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      <Show when={loading} fallback={icon}>
        <Loader2 className="size-4 animate-spin" aria-hidden />
      </Show>
      {children}
    </button>
  );
}
