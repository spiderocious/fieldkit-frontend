import { Repeat, Show } from 'meemaw';
import { Link } from 'react-router-dom';

import { StatusStrip } from '@features/sync-status/status-strip';
import { ChevronRight, ImageIcon, LogOut, MapPin, Plus } from '@icons';
import { ROUTES } from '@shared/constants/routes';
import type { LocalVisit } from '@shared/db/fieldkit-db';
import type { OutboxRecord } from '@shared/offline';
import { clearSession, useSession } from '@shared/session/session';
import { Badge, type Tone } from '@ui/badge';
import { Empty } from '@ui/empty';
import { formatDateTime } from '@ui/format';
import { Page } from '@ui/page';

import { useLocalVisits, useServerRefresh } from './use-visits';
import { intentsFor, visitSyncState, type VisitSyncState } from './visits.repo';

const stateTone: Record<VisitSyncState, { tone: Tone; label: string }> = {
  synced: { tone: 'success', label: 'Synced' },
  pending: { tone: 'warning', label: 'Waiting to send' },
  failed: { tone: 'danger', label: 'Needs attention' },
  conflicted: { tone: 'danger', label: 'Conflict' },
};

function VisitRow({ visit, records }: Readonly<{ visit: LocalVisit; records: OutboxRecord[] }>) {
  const state = visitSyncState(intentsFor(visit.id, records));
  const { tone, label } = stateTone[state];
  return (
    <Link
      to={ROUTES.visit(visit.id)}
      className="flex items-center gap-3 rounded-[var(--radius-lg)] border-2 border-ink bg-white px-4 py-3 transition-colors hover:bg-blue-pastel/40"
      data-testid="visit-row"
      data-sync-state={state}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium text-ink">{visit.shop_name}</p>
          <Badge tone={tone}>{label}</Badge>
        </div>
        <p className="truncate text-sm text-ink-soft">{visit.owner_name}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-ink-muted">
          <span>{formatDateTime(visit.captured_at)}</span>
          <Show when={visit.lat !== null}>
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="size-3" aria-hidden /> located
            </span>
          </Show>
          <Show when={visit.photo_count > 0}>
            <span className="inline-flex items-center gap-0.5">
              <ImageIcon className="size-3" aria-hidden /> {visit.photo_count}
            </span>
          </Show>
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
    </Link>
  );
}

export function VisitsListPage() {
  const { session } = useSession();
  const { visits, records } = useLocalVisits();
  const { fromCache } = useServerRefresh();

  return (
    <Page
      title={session ? `Hi, ${session.agent.name.split(' ')[0]}` : 'Visits'}
      banner={<StatusStrip />}
      actions={
        <button type="button" onClick={() => void clearSession()} aria-label="Sign out" className="flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-surface-2">
          <LogOut className="size-5" />
        </button>
      }
    >
      <Show when={fromCache}>
        <p className="rounded-[var(--radius-md)] bg-yellow-pastel px-3.5 py-2 text-sm text-ink">Showing the last copy this device received. The server could not be reached.</p>
      </Show>
      <Show
        when={visits !== undefined && visits.length > 0}
        fallback={
          <Show when={visits !== undefined}>
            <Empty
              icon={<MapPin className="size-6" />}
              title="No visits on this device yet"
              body="Start a visit. It saves here first and reaches the server when there is signal."
            />
          </Show>
        }
      >
        <ul className="flex flex-col gap-2">
          <Repeat each={visits ?? []}>
            {(v) => (
              <li key={v.id}>
                <VisitRow visit={v} records={records} />
              </li>
            )}
          </Repeat>
        </ul>
      </Show>
      <Link
        to={ROUTES.newVisit}
        className="fixed right-4 bottom-6 z-10 flex h-14 items-center gap-2 rounded-full border-2 border-ink bg-brand px-5 font-medium text-white shadow-lg shadow-ink/20 hover:bg-brand-strong"
      >
        <Plus className="size-5" aria-hidden /> New visit
      </Link>
    </Page>
  );
}
