import type { InputHTMLAttributes } from 'react';
import { Show } from 'meemaw';

import { cn } from './cn';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Inline error under the control. Errors live next to the thing that failed. */
  error?: string | undefined;
  hint?: string;
}

/** A labelled input with its own inline error. */
export function Field({ label, error, hint, id, className, ...rest }: Readonly<Props>) {
  const inputId = id ?? rest.name ?? label.toLowerCase().replace(/\s+/g, '-');
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-12 w-full rounded-[var(--radius-md)] border-2 bg-white px-3.5 text-base text-ink outline-none transition-colors',
          'placeholder:text-ink-muted focus:border-brand',
          error ? 'border-red' : 'border-ink',
        )}
        {...rest}
      />
      <Show when={Boolean(error)}>
        <p id={`${inputId}-error`} role="alert" className="text-sm text-red">
          {error}
        </p>
      </Show>
      <Show when={!error && Boolean(hint)}>
        <p id={`${inputId}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      </Show>
    </div>
  );
}
