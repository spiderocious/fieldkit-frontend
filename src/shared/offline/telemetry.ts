// Observability from a device that is usually offline: buffer events in
// IndexedDB, ship them in batches when online, and flush with a keepalive
// request when the tab goes to the background. This is the outbox pattern
// again with events as the payload.
import type { OfflineDb, TelemetryRecord } from './db';

export interface TelemetryOptions {
  db: OfflineDb;
  /** Sends a batch. Resolves true when the server accepted it. */
  ship: (events: TelemetryRecord[], keepalive: boolean) => Promise<boolean>;
  batchSize?: number;
  windowRef?: Window | null;
}

export interface Telemetry {
  track(kind: string, payload?: Record<string, unknown>): Promise<void>;
  flush(keepalive?: boolean): Promise<number>;
  start(): void;
  stop(): void;
}

export function createTelemetry(opts: TelemetryOptions): Telemetry {
  const batchSize = opts.batchSize ?? 100;
  const win = opts.windowRef === undefined ? (typeof window !== 'undefined' ? window : null) : opts.windowRef;
  let flushing = false;

  async function track(kind: string, payload: Record<string, unknown> = {}) {
    await opts.db.telemetry.add({ kind, payload, occurredAt: new Date().toISOString() });
  }

  async function flush(keepalive = false): Promise<number> {
    if (flushing) return 0;
    flushing = true;
    try {
      let shipped = 0;
      for (;;) {
        const batch = await opts.db.telemetry.orderBy('id').limit(batchSize).toArray();
        if (batch.length === 0) break;
        const ok = await opts.ship(batch, keepalive);
        if (!ok) break;
        await opts.db.telemetry.bulkDelete(batch.map((b) => b.id as number));
        shipped += batch.length;
        if (batch.length < batchSize) break;
      }
      return shipped;
    } finally {
      flushing = false;
    }
  }

  function onHidden() {
    // unload does not fire reliably on mobile; visibilitychange does. The
    // ship function uses fetch keepalive so the request outlives the tab.
    if (win?.document.visibilityState === 'hidden') void flush(true);
  }

  return {
    track,
    flush,
    start() {
      win?.document.addEventListener('visibilitychange', onHidden);
    },
    stop() {
      win?.document.removeEventListener('visibilitychange', onHidden);
    },
  };
}
