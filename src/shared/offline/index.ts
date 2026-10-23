// Boundary barrel for the offline core. Apps import from '@shared/offline'
// and wire createOffline() once in their provider.
import type { OfflineDb, TelemetryRecord } from './db';
import { enqueue, type EnqueueInput, type OutboxRecord } from './outbox';
import { createSync, type SendResult, type Sync } from './sync';
import { createTelemetry, type Telemetry } from './telemetry';

export type { OfflineDb, TelemetryRecord, BlobRecord, KvRecord, StoreSchema } from './db';
export { OfflineDb as OfflineDatabase } from './db';
export type { OutboxRecord, OutboxStatus, OutboxStats, EnqueueInput } from './outbox';
export { enqueue, recoverInflight, readyRecords, resolveConflict, retryNow, outboxStats } from './outbox';
export { nextDelayMs } from './backoff';
export type { Sync, SyncState, SendResult, DrainReport, DrainOptions } from './sync';
export { createSync } from './sync';
export type { Telemetry } from './telemetry';
export { createTelemetry } from './telemetry';
export { putPhoto, getPhoto, deletePhoto, photoTier } from './photos';
export type { PhotoTier } from './photos';
export { compressImage } from './compress';
export type { CompressedImage } from './compress';
export { requestPersistence, storageStatus, deviceHints, photoBudgetBytes, PHOTO_STOP_RATIO } from './storage';
export type { StorageStatus, DeviceHints } from './storage';
export { registerServiceWorker } from './register-sw';
export type { ServiceWorkerStatus } from './register-sw';

export interface OfflineOptions {
  db: OfflineDb;
  send: (record: OutboxRecord) => Promise<SendResult>;
  ship: (events: TelemetryRecord[], keepalive: boolean) => Promise<boolean>;
  probeUrl: string;
  lockName: string;
  ordered?: boolean;
}

export interface Offline {
  db: OfflineDb;
  sync: Sync;
  telemetry: Telemetry;
  enqueue(input: EnqueueInput): Promise<OutboxRecord>;
  start(): Promise<void>;
  stop(): void;
}

/** Wires the queue, the sync engine and telemetry together for one app. */
export function createOffline(opts: OfflineOptions): Offline {
  const telemetry = createTelemetry({ db: opts.db, ship: opts.ship });
  const sync = createSync({
    db: opts.db,
    send: opts.send,
    probeUrl: opts.probeUrl,
    lockName: opts.lockName,
    ordered: opts.ordered ?? false,
    onDrained: (report) => {
      void telemetry.track('queue.drained', { ...report });
      void telemetry.flush();
    },
  });
  return {
    db: opts.db,
    sync,
    telemetry,
    enqueue: (input) => enqueue(opts.db, input),
    async start() {
      telemetry.start();
      await sync.start();
    },
    stop() {
      sync.stop();
      telemetry.stop();
    },
  };
}
