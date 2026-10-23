import type { HTMLAttributes } from 'react';

import { cn } from './cn';

/** A deck card: white, ink stroke, large radius. */
export function Card({ className, ...rest }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return <div className={cn('rounded-[var(--radius-lg)] border-2 border-ink bg-white p-4', className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: Readonly<HTMLAttributes<HTMLHeadingElement>>) {
  return <h2 className={cn('text-xs font-semibold tracking-[0.08em] text-ink-soft uppercase', className)} {...rest} />;
}
