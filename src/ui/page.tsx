import type { ReactNode } from 'react';
import { Show } from 'meemaw';
import { Link } from 'react-router-dom';

import { ArrowLeft } from '@icons';

import { cn } from './cn';

interface Props {
  title: string;
  /** Where the back arrow goes. No arrow when absent. */
  back?: string;
  /** Right side of the header. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Rendered under the header, e.g. a status strip. */
  banner?: ReactNode;
}

/** A phone-width page with a sticky header. */
export function Page({ title, back, actions, children, className, banner }: Readonly<Props>) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur">
        <div className="flex h-14 items-center gap-2 px-4">
          <Show when={Boolean(back)}>
            <Link to={back ?? '/'} aria-label="Back" className="-ml-2 flex size-9 items-center justify-center rounded-full text-ink hover:bg-surface-2">
              <ArrowLeft className="size-5" />
            </Link>
          </Show>
          <h1 className="flex-1 truncate text-lg font-semibold text-ink">{title}</h1>
          {actions}
        </div>
        {banner}
      </header>
      <main className={cn('flex flex-1 flex-col gap-4 px-4 py-4 pb-28', className)}>{children}</main>
    </div>
  );
}
