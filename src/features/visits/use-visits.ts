// Reads for the visits feature. Screens read the device database; the
// server feeds that database when it can be reached.
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';

import { useOffline } from '@app/app/app.provider';
import type { LocalVisit } from '@shared/db/fieldkit-db';
import type { OutboxRecord } from '@shared/offline';

import { listVisits } from './visits.api';
import { mergeServerVisits } from './visits.repo';

export const visitKeys = {
  list: ['visits', 'list'] as const,
  stats: ['visits', 'stats'] as const,
};

/** Every visit on the device, newest first, plus the queue records about them. */
export function useLocalVisits(): { visits: LocalVisit[] | undefined; records: OutboxRecord[] } {
  const { db } = useOffline();
  const visits = useLiveQuery(() => db.visits.orderBy('captured_at').reverse().toArray(), [db]);
  const records = useLiveQuery(() => db.outbox.toArray(), [db]) ?? [];
  return { visits, records };
}

export function useLocalVisit(id: string | undefined) {
  const { db } = useOffline();
  const visit = useLiveQuery(() => (id ? db.visits.get(id) : undefined), [db, id]);
  const photos = useLiveQuery(() => (id ? db.photos.where('visit_id').equals(id).toArray() : []), [db, id]) ?? [];
  const records = useLiveQuery(() => db.outbox.toArray(), [db]) ?? [];
  return { visit, photos, records };
}

/**
 * Pulls the first page from the server whenever we believe we are online
 * and folds it into the device store. Returns whether the last answer came
 * from the service worker's cache.
 */
export function useServerRefresh(): { fromCache: boolean; refreshing: boolean; refresh: () => void } {
  const { db, sync } = useOffline();
  const query = useQuery({
    queryKey: visitKeys.list,
    queryFn: () => listVisits(),
    enabled: sync.online !== false,
    refetchInterval: 20_000,
  });
  const data = query.data;
  useEffect(() => {
    if (data && !data.fromCache) void mergeServerVisits(db, data.data);
  }, [db, data]);
  // The moment the probe says the server is back, ask it again rather than
  // showing the service worker's copy until the next interval.
  const online = sync.online;
  useEffect(() => {
    if (online) void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch is stable per query
  }, [online]);
  return { fromCache: data?.fromCache ?? false, refreshing: query.isFetching, refresh: () => void query.refetch() };
}
