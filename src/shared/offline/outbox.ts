// The outbox pattern: a durable queue of things the user wants to happen.
// The UI writes an intent here and returns. The sync engine sends them.
import type { OfflineDb } from './db';

/**
 * Lifecycle of a record.
 *
 *   pending   waiting to be sent
 *   inflight  a send is in progress; written to disk BEFORE the request
 *             leaves so a crash mid-send is found and retried on restart
 *   failed    gave up; lastReason says why; a person may need to see it
 *   conflicted the server refused with the current version; the user
 *             decides, then the record is re-enqueued
 *
 * Successful records are deleted, so "done" is the absence of a row.
 */
export type OutboxStatus = 'pending' | 'inflight' | 'failed' | 'conflicted';

/** An intent, not a request. The sender turns it into HTTP today. */
export interface OutboxRecord {
  id: string;
  type: string;
  payload: unknown;
  /** Generated once, here. Never per attempt. */
  idempotencyKey: string;
  status: OutboxStatus;
  attempt: number;
  /** Epoch ms. The drainer only picks records whose time has come. */
  nextAttemptAt: number;
  /** The version the client read before editing, for conflict detection. */
  baseVersion?: number;
  createdAt: number;
  updatedAt: number;
  lastReason?: string;
  /** Server-supplied current state on a version conflict. */
  conflict?: unknown;
}

export interface EnqueueInput {
  type: string;
  payload: unknown;
  baseVersion?: number;
  /** Optional stable id so an intent can be found again (e.g. the visit id). */
  id?: string;
}

/** Writes a new intent. Returns the stored record. */
export async function enqueue(db: OfflineDb, input: EnqueueInput, now = Date.now()): Promise<OutboxRecord> {
  const record: OutboxRecord = {
    id: input.id ?? crypto.randomUUID(),
    type: input.type,
    payload: input.payload,
    idempotencyKey: crypto.randomUUID(),
    status: 'pending',
    attempt: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    ...(input.baseVersion !== undefined && { baseVersion: input.baseVersion }),
  };
  await db.outbox.put(record);
  return record;
}

/**
 * Records left inflight by a crash or a closed tab go back to pending. The
 * idempotency key makes the retry safe. Called once on app start.
 */
export async function recoverInflight(db: OfflineDb, now = Date.now()): Promise<number> {
  return db.outbox
    .where('status')
    .equals('inflight')
    .modify((r) => {
      r.status = 'pending';
      r.nextAttemptAt = now;
      r.updatedAt = now;
    });
}

/** Records whose turn has come, oldest first. */
export async function readyRecords(db: OfflineDb, now = Date.now()): Promise<OutboxRecord[]> {
  const pending = await db.outbox.where('status').equals('pending').sortBy('createdAt');
  return pending.filter((r) => r.nextAttemptAt <= now);
}

/** Re-enqueues a conflicted record with a new base version and payload. */
export async function resolveConflict(
  db: OfflineDb,
  id: string,
  next: { payload: unknown; baseVersion: number },
  now = Date.now(),
): Promise<void> {
  await db.outbox.update(id, {
    payload: next.payload,
    baseVersion: next.baseVersion,
    status: 'pending',
    attempt: 0,
    nextAttemptAt: now,
    updatedAt: now,
    conflict: undefined,
    lastReason: undefined,
  });
}

/** Puts a failed record back in the queue by hand. */
export async function retryNow(db: OfflineDb, id: string, now = Date.now()): Promise<void> {
  await db.outbox.update(id, { status: 'pending', attempt: 0, nextAttemptAt: now, updatedAt: now, lastReason: undefined });
}

/** The five numbers the panel shows, computed from the queue. */
export interface OutboxStats {
  pending: number;
  inflight: number;
  failed: number;
  conflicted: number;
  failuresByReason: Record<string, number>;
  /** Age in ms of the oldest record still waiting, or null. */
  oldestPendingAgeMs: number | null;
}

export async function outboxStats(db: OfflineDb, now = Date.now()): Promise<OutboxStats> {
  const all = await db.outbox.toArray();
  const stats: OutboxStats = { pending: 0, inflight: 0, failed: 0, conflicted: 0, failuresByReason: {}, oldestPendingAgeMs: null };
  let oldest: number | null = null;
  for (const r of all) {
    stats[r.status] += 1;
    if (r.status === 'pending' || r.status === 'inflight') {
      oldest = oldest === null ? r.createdAt : Math.min(oldest, r.createdAt);
    }
    if (r.status === 'failed') {
      const reason = r.lastReason ?? 'unknown';
      stats.failuresByReason[reason] = (stats.failuresByReason[reason] ?? 0) + 1;
    }
  }
  stats.oldestPendingAgeMs = oldest === null ? null : now - oldest;
  return stats;
}
