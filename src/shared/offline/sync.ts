// The sync engine. It is the only thing that talks to the network for
// writes. It drains the outbox under a Web Lock, backs off with jitter,
// decides "online" with a real probe, and is triggered by the online event,
// a timer, app start, the panel, and (where supported) Background Sync.
import { nextDelayMs } from './backoff';
import type { OfflineDb } from './db';
import { readyRecords, recoverInflight, type OutboxRecord } from './outbox';

/** What the app-owned sender reports back for one record. */
export type SendResult =
  | { ok: true }
  | { ok: false; retry: true; reason: string; retryAfterMs?: number }
  | { ok: false; retry: false; reason: string; conflict?: unknown };

export interface SyncState {
  /** null until the first probe has run. */
  online: boolean | null;
  draining: boolean;
  lastSyncAt: number | null;
  lastDrain: DrainReport | null;
  /** Whether this tab holds the drain lock right now. */
  holdsLock: boolean;
}

export interface DrainReport {
  sent: number;
  retried: number;
  failed: number;
  conflicted: number;
  skippedLocked: boolean;
}

export interface SyncOptions {
  db: OfflineDb;
  /** Turns an intent into HTTP. Owned by the app; the core never sees URLs. */
  send: (record: OutboxRecord) => Promise<SendResult>;
  /** Small GET on your own server. 2xx means online. */
  probeUrl: string;
  /** Web Lock name. One tab drains at a time. */
  lockName: string;
  /** When true, a retryable failure stops the drain so order is preserved. */
  ordered?: boolean;
  maxAttempts?: number;
  timerMs?: number;
  probeTimeoutMs?: number;
  /** Called after a successful drain, e.g. to flush telemetry. */
  onDrained?: (report: DrainReport) => void;
  // Injection points for tests.
  now?: () => number;
  random?: () => number;
  fetchFn?: typeof fetch;
  locks?: LockManager | null;
  windowRef?: Window | null;
}

export interface DrainOptions {
  /** A person asked: send everything pending now, ignoring backoff timers. */
  force?: boolean;
}

export interface Sync {
  start(): Promise<void>;
  stop(): void;
  drain(opts?: DrainOptions): Promise<DrainReport>;
  probe(): Promise<boolean>;
  getState(): SyncState;
  subscribe(listener: (s: SyncState) => void): () => void;
}

const nothing: DrainReport = { sent: 0, retried: 0, failed: 0, conflicted: 0, skippedLocked: false };

export function createSync(opts: SyncOptions): Sync {
  const now = opts.now ?? (() => Date.now());
  const maxAttempts = opts.maxAttempts ?? 8;
  const fetchFn = opts.fetchFn ?? fetch;
  const locks = opts.locks === undefined ? (typeof navigator !== 'undefined' ? navigator.locks : null) : opts.locks;
  const win = opts.windowRef === undefined ? (typeof window !== 'undefined' ? window : null) : opts.windowRef;

  let state: SyncState = { online: null, draining: false, lastSyncAt: null, lastDrain: null, holdsLock: false };
  const listeners = new Set<(s: SyncState) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = true;

  function set(patch: Partial<SyncState>) {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  }

  async function probe(): Promise<boolean> {
    try {
      const res = await fetchFn(opts.probeUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(opts.probeTimeoutMs ?? 3000),
      });
      const online = res.ok;
      set({ online });
      return online;
    } catch {
      set({ online: false });
      return false;
    }
  }

  /** The drain body, run while holding the lock. */
  async function drainLocked(force: boolean): Promise<DrainReport> {
    const report: DrainReport = { ...nothing };
    if (!(await probe())) return report;

    const ready = await readyRecords(opts.db, force ? Number.POSITIVE_INFINITY : now());
    for (const record of ready) {
      const t = now();
      // Persist inflight before the request leaves: a crash after this line
      // is recoverable, and the idempotency key makes the retry safe.
      await opts.db.outbox.update(record.id, { status: 'inflight', updatedAt: t });

      let result: SendResult;
      try {
        result = await opts.send({ ...record, status: 'inflight' });
      } catch (err) {
        result = { ok: false, retry: true, reason: err instanceof Error ? err.name : 'network' };
      }

      if (result.ok) {
        await opts.db.outbox.delete(record.id);
        report.sent += 1;
        continue;
      }

      if (!result.retry) {
        if (result.conflict !== undefined) {
          await opts.db.outbox.update(record.id, {
            status: 'conflicted',
            conflict: result.conflict,
            lastReason: result.reason,
            updatedAt: now(),
          });
          report.conflicted += 1;
        } else {
          await opts.db.outbox.update(record.id, { status: 'failed', lastReason: result.reason, updatedAt: now() });
          report.failed += 1;
        }
        continue;
      }

      const attempt = record.attempt + 1;
      if (attempt >= maxAttempts) {
        await opts.db.outbox.update(record.id, { status: 'failed', attempt, lastReason: 'attempts_exhausted', updatedAt: now() });
        report.failed += 1;
      } else {
        const delay = result.retryAfterMs ?? nextDelayMs(attempt, { random: opts.random ?? Math.random });
        await opts.db.outbox.update(record.id, {
          status: 'pending',
          attempt,
          nextAttemptAt: now() + delay,
          lastReason: result.reason,
          updatedAt: now(),
        });
        report.retried += 1;
      }
      // Money and anything else order-sensitive: never let a later intent
      // overtake one that is still retrying.
      if (opts.ordered) break;
    }
    return report;
  }

  async function drain(drainOpts: DrainOptions = {}): Promise<DrainReport> {
    const force = drainOpts.force ?? false;
    if (state.draining) return { ...nothing };
    set({ draining: true });
    try {
      let report: DrainReport;
      if (locks) {
        const r = await locks.request(opts.lockName, { ifAvailable: true }, async (lock) => {
          if (!lock) return null;
          set({ holdsLock: true });
          try {
            return await drainLocked(force);
          } finally {
            set({ holdsLock: false });
          }
        });
        report = r ?? { ...nothing, skippedLocked: true };
      } else {
        report = await drainLocked(force);
      }
      if (report.sent > 0 || (state.online && !report.skippedLocked)) set({ lastSyncAt: now() });
      set({ lastDrain: report });
      if (report.sent > 0) opts.onDrained?.(report);
      return report;
    } finally {
      set({ draining: false });
    }
  }

  async function onOnline() {
    await drain();
  }
  // navigator.onLine lies in one direction only: "online" may mean a captive
  // portal or a dead cell, but "offline" is the truth. Believe it at once.
  function onOffline() {
    set({ online: false });
  }
  function onVisible() {
    if (win?.document.visibilityState === 'visible') void drain();
  }
  function onMessage(e: MessageEvent) {
    if (e.data?.type === 'drain') void drain();
  }

  async function start() {
    if (!stopped) return;
    stopped = false;
    await recoverInflight(opts.db, now());
    win?.addEventListener('online', onOnline);
    win?.addEventListener('offline', onOffline);
    win?.document.addEventListener('visibilitychange', onVisible);
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', onMessage);
    }
    timer = setInterval(async () => {
      const pending = await opts.db.outbox.where('status').equals('pending').count();
      if (pending > 0) void drain();
    }, opts.timerMs ?? 30_000);
    await drain();
  }

  function stop() {
    stopped = true;
    win?.removeEventListener('online', onOnline);
    win?.removeEventListener('offline', onOffline);
    win?.document.removeEventListener('visibilitychange', onVisible);
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.removeEventListener('message', onMessage);
    }
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    drain,
    probe,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}
