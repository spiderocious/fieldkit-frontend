import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from './cn';

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

// Deck pills: a pastel fill with ink text, never coloured text on white.
const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-soft',
  brand: 'bg-brand-pastel text-ink',
  success: 'bg-green-pastel text-ink',
  warning: 'bg-yellow-pastel text-ink',
  danger: 'bg-red-pastel text-ink',
};

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  children: ReactNode;
  icon?: ReactNode;
}

export function Badge({ tone = 'neutral', children, className, icon, ...rest }: Readonly<Props>) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', tones[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
