// The sync panel: the five numbers from the talk, plus storage, the service
// worker, and a button that drains the queue by hand.
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { Repeat, Show } from 'meemaw';
import { useEffect, useState, type ReactNode } from 'react';

import { useOffline } from '@app/app/app.provider';
import { RefreshCw } from '@icons';
import { ROUTES } from '@shared/constants/routes';
import { deviceHints, photoBudgetBytes, retryNow, storageStatus } from '@shared/offline';
import { Badge } from '@ui/badge';
import { Button } from '@ui/button';
import { Card, CardTitle } from '@ui/card';
import { formatAge, formatBytes, formatTime } from '@ui/format';
import { Page } from '@ui/page';

import { intentLabel, reasonLabel } from './labels';
import { useOutboxStats } from './use-outbox-stats';

function Stat({ label, value, testId }: Readonly<{ label: string; value: ReactNode; testId?: string }>) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[var(--radius-md)] bg-surface-2 px-3 py-2.5">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-lg font-semibold text-ink tabular-nums" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

export function SyncPage() {
  const { db, offline, sync, persisted } = useOffline();
  const stats = useOutboxStats();
  const storage = useQuery({ queryKey: ['storage'], queryFn: storageStatus, refetchInterval: 5000 });
  const photoCount = useLiveQuery(() => db.photos.count(), [db]) ?? 0;
  const failed = useLiveQuery(() => db.outbox.where('status').anyOf('failed', 'conflicted').toArray(), [db]) ?? [];
  const retrying = useLiveQuery(() => db.outbox.where('status').equals('pending').filter((r) => r.attempt > 0).toArray(), [db]) ?? [];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const hints = deviceHints();
  const reasons = Object.entries(stats.failuresByReason);

  return (
    <Page
      title="Sync"
      back={ROUTES.visits}
      actions={
        <Button size="sm" icon={<RefreshCw className="size-4" aria-hidden />} loading={sync.draining} onClick={() => void offline.sync.drain({ force: true })} data-testid="sync-now">
          Sync now
        </Button>
      }
    >
      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <CardTitle>Queue</CardTitle>
          <Badge tone={sync.online === false ? 'neutral' : 'success'} data-testid="probe-state">
            {sync.online === null ? 'checking' : sync.online ? 'connected' : 'no connection'}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Waiting to send" value={stats.pending + stats.inflight} testId="stat-pending" />
          <Stat label="Oldest waiting" value={stats.oldestPendingAgeMs === null ? 'none' : formatAge(stats.oldestPendingAgeMs)} />
          <Stat label="Failed" value={stats.failed} testId="stat-failed" />
          <Stat label="Conflicts" value={stats.conflicted} testId="stat-conflicted" />
        </div>
        <p className="text-xs text-ink-muted">
          Last synced: {sync.lastSyncAt ? formatTime(new Date(sync.lastSyncAt).toISOString()) : 'not yet'}
        </p>
        <Show when={reasons.length > 0}>
          <div className="flex flex-wrap gap-1.5">
            <Repeat each={reasons}>
              {([reason, n]) => (
                <Badge key={reason} tone="danger">
                  {reasonLabel(reason)} × {n}
                </Badge>
              )}
            </Repeat>
          </div>
        </Show>
      </Card>

      <Show when={retrying.length > 0}>
        <Card className="flex flex-col gap-2 border-yellow">
          <CardTitle className="text-ink">Retrying</CardTitle>
          <Repeat each={retrying}>
            {(r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm" data-testid="retrying-row">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{intentLabel(r.type)}</p>
                  <p className="truncate text-xs text-ink-muted">
                    Attempt {r.attempt} · {reasonLabel(r.lastReason)}
                  </p>
                </div>
                <span className="text-xs text-ink-soft tabular-nums whitespace-nowrap">next try in {formatAge(Math.max(0, r.nextAttemptAt - now))}</span>
              </div>
            )}
          </Repeat>
        </Card>
      </Show>

      <Show when={failed.length > 0}>
        <Card className="flex flex-col gap-2">
          <CardTitle>Needs attention</CardTitle>
          <Repeat each={failed}>
            {(r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{intentLabel(r.type)}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {reasonLabel(r.lastReason)} · attempt {r.attempt}
                  </p>
                </div>
                <Show when={r.status === 'failed'}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      await retryNow(db, r.id);
                      void offline.sync.drain();
                    }}
                  >
                    Retry
                  </Button>
                </Show>
              </div>
            )}
          </Repeat>
        </Card>
      </Show>

      <Card className="flex flex-col gap-3">
        <CardTitle>On this phone</CardTitle>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Space used" value={storage.data ? formatBytes(storage.data.usage) : '…'} />
          <Stat label="Space available" value={storage.data ? formatBytes(Math.max(0, storage.data.quota - storage.data.usage)) : '…'} />
          <Stat label="Kept safe" value={persisted === null ? 'unknown' : persisted ? 'yes' : 'best effort'} />
          <Stat label="Photos stored" value={photoCount} />
        </div>
        <Show when={storage.data !== undefined && storage.data.quota > 0}>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, (storage.data?.ratio ?? 0) * 100).toFixed(1)}%` }} />
          </div>
        </Show>
        <p className="text-xs text-ink-muted">Photos are kept at up to {formatBytes(photoBudgetBytes(hints))} each · Version {__BUILD_ID__}</p>
      </Card>
    </Page>
  );
}
