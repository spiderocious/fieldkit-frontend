import type { ReactNode } from 'react';
import { Show } from 'meemaw';

import { AlertTriangle } from '@icons';

import { cn } from './cn';

interface Props {
  message: string | null | undefined;
  /** Optional action, e.g. a retry button. */
  action?: ReactNode;
  className?: string;
}

/** An error shown where it happened, not as a toast somewhere else. */
export function InlineError({ message, action, className }: Readonly<Props>) {
  return (
    <Show when={Boolean(message)}>
      <div role="alert" className={cn('flex items-start gap-2.5 rounded-[var(--radius-md)] border-2 border-red bg-red-pastel px-3.5 py-3 text-sm text-ink', className)}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span className="flex-1">{message}</span>
        {action}
      </div>
    </Show>
  );
}
