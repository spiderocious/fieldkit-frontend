import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}

export function Empty({ icon, title, body, action }: Readonly<Props>) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border-2 border-dashed border-ink-muted px-6 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-soft">{icon}</div>
      <p className="font-medium text-ink">{title}</p>
      {body && <p className="max-w-xs text-sm text-ink-muted">{body}</p>}
      {action}
    </div>
  );
}
