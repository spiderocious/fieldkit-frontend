// The big-screen view for the room: what the server has received. Polls
// every few seconds so the audience watches visits arrive as devices sync.
import { useQuery } from '@tanstack/react-query';
import { Repeat, Show } from 'meemaw';

import { getStats } from '@features/visits/visits.api';
import { visitKeys } from '@features/visits/use-visits';
import { useSession } from '@shared/session/session';
import { Navigate } from 'react-router-dom';

import { ROUTES } from '@shared/constants/routes';

export function OpsPage() {
  const { session, ready } = useSession();
  const stats = useQuery({ queryKey: visitKeys.stats, queryFn: getStats, refetchInterval: 3000, enabled: Boolean(session) });

  if (ready && !session) return <Navigate to={ROUTES.login} replace />;

  return (
    <div className="min-h-dvh bg-ink px-8 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm tracking-widest text-white/60 uppercase">Fieldkit · server view</p>
        <h1 className="mt-1 text-3xl font-semibold">Visits received</h1>
        <div className="mt-8 grid grid-cols-3 gap-4">
          <div className="rounded-[var(--radius-lg)] border-2 border-white/40 p-6">
            <p className="text-sm text-white/60">Total</p>
            <p className="mt-1 text-6xl font-semibold tabular-nums" data-testid="ops-total">
              {stats.data?.total ?? '…'}
            </p>
          </div>
          <div className="rounded-[var(--radius-lg)] border-2 border-white/40 p-6">
            <p className="text-sm text-white/60">Today</p>
            <p className="mt-1 text-6xl font-semibold tabular-nums" data-testid="ops-today">
              {stats.data?.received_today ?? '…'}
            </p>
          </div>
          <div className="rounded-[var(--radius-lg)] border-2 border-white/40 p-6">
            <p className="text-sm text-white/60">Photos</p>
            <p className="mt-1 text-6xl font-semibold tabular-nums">{stats.data?.photos ?? '…'}</p>
          </div>
        </div>
        <h2 className="mt-10 text-lg font-medium text-white/80">By agent</h2>
        <Show when={(stats.data?.by_agent.length ?? 0) > 0} fallback={<p className="mt-2 text-white/50">Nothing yet.</p>}>
          <ul className="mt-3 divide-y divide-white/20 rounded-[var(--radius-lg)] border-2 border-white/40">
            <Repeat each={stats.data?.by_agent ?? []}>
              {(a) => (
                <li key={a.agent_id} className="flex items-center justify-between px-5 py-3 text-xl">
                  <span>{a.name}</span>
                  <span className="tabular-nums">{a.count}</span>
                </li>
              )}
            </Repeat>
          </ul>
        </Show>
        <Show when={stats.isError}>
          <p className="mt-4 text-sm text-red-pastel">Could not reach the server. Retrying.</p>
        </Show>
      </div>
    </div>
  );
}
