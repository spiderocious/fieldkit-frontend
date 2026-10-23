// The device database. Dexie over IndexedDB: structured, indexed,
// transactional, asynchronous. The offline core owns four stores; the app
// adds its own on top.
import Dexie, { type Table } from 'dexie';

import type { OutboxRecord } from './outbox';

/** One buffered telemetry event, shipped in batches when online. */
export interface TelemetryRecord {
  id?: number;
  kind: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

/**
 * A binary stored in IndexedDB when OPFS is unavailable. Kept as raw bytes
 * plus a type: ArrayBuffers round-trip through every IndexedDB
 * implementation, Blobs have not always.
 */
export interface BlobRecord {
  key: string;
  bytes: ArrayBuffer;
  type: string;
  size: number;
}

/** Small key/value settings: the session token, the storage tier in use. */
export interface KvRecord {
  key: string;
  value: unknown;
}

/** Store definitions in Dexie's schema syntax, keyed by store name. */
export type StoreSchema = Record<string, string>;

const coreStores: StoreSchema = {
  outbox: 'id, status, nextAttemptAt, createdAt, type',
  telemetry: '++id, occurredAt',
  blobs: 'key',
  kv: 'key',
};

/**
 * Base database every app extends. Subclasses declare their own typed
 * tables and pass their store schema to the constructor.
 */
export class OfflineDb extends Dexie {
  // `declare`, not `!`: Dexie assigns these during stores(); a class field
  // would be re-initialised to undefined after the constructor returns.
  declare outbox: Table<OutboxRecord, string>;
  declare telemetry: Table<TelemetryRecord, number>;
  declare blobs: Table<BlobRecord, string>;
  declare kv: Table<KvRecord, string>;

  constructor(name: string, appStores: StoreSchema = {}, version = 1) {
    super(name);
    this.version(version).stores({ ...coreStores, ...appStores });
  }

  /** Reads a setting, or the fallback when absent. */
  async getKv<T>(key: string, fallback: T): Promise<T> {
    const row = await this.kv.get(key);
    return row === undefined ? fallback : (row.value as T);
  }

  /** Writes a setting. */
  async setKv(key: string, value: unknown): Promise<void> {
    await this.kv.put({ key, value });
  }
}
