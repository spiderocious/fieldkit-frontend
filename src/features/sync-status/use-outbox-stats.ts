import { useLiveQuery } from 'dexie-react-hooks';

import { useOffline } from '@app/app/app.provider';
import { outboxStats, type OutboxStats } from '@shared/offline';

const empty: OutboxStats = { pending: 0, inflight: 0, failed: 0, conflicted: 0, failuresByReason: {}, oldestPendingAgeMs: null };

/** Live queue numbers; re-runs whenever the outbox table changes. */
export function useOutboxStats(): OutboxStats {
  const { db } = useOffline();
  return useLiveQuery(() => outboxStats(db), [db]) ?? empty;
}
