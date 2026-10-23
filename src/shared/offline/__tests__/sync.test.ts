import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OfflineDb } from '../db';
import { enqueue, type OutboxRecord } from '../outbox';
import { createSync, type SendResult } from '../sync';

let db: OfflineDb;
let clock: number;

const onlineProbe = vi.fn(async () => new Response(null, { status: 204 }));
const offlineProbe = vi.fn(async () => {
  throw new TypeError('Failed to fetch');
});

function sync(send: (r: OutboxRecord) => Promise<SendResult>, extra: Partial<Parameters<typeof createSync>[0]> = {}) {
  return createSync({
    db,
    send,
    probeUrl: '/api/v1/ping',
    lockName: 'test',
    locks: null,
    windowRef: null,
    now: () => clock,
    random: () => 1,
    fetchFn: onlineProbe as unknown as typeof fetch,
    ...extra,
  });
}

beforeEach(async () => {
  db = new OfflineDb(`sync-${crypto.randomUUID()}`);
  await db.open();
  clock = 10_000;
});

describe('drain', () => {
  it('sends ready records and deletes them on success', async () => {
    await enqueue(db, { type: 'a', payload: 1 }, clock);
    await enqueue(db, { type: 'b', payload: 2 }, clock);
    const send = vi.fn(async () => ({ ok: true }) as SendResult);
    const report = await sync(send).drain();
    expect(report).toMatchObject({ sent: 2, retried: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await db.outbox.count()).toBe(0);
  });

  it('does nothing when the probe says offline', async () => {
    await enqueue(db, { type: 'a', payload: 1 }, clock);
    const send = vi.fn();
    const s = sync(send, { fetchFn: offlineProbe as unknown as typeof fetch });
    const report = await s.drain();
    expect(report.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(s.getState().online).toBe(false);
  });

  it('marks inflight on disk before sending', async () => {
    const r = await enqueue(db, { type: 'a', payload: 1 }, clock);
    let seenStatus: string | undefined;
    const send = async () => {
      seenStatus = (await db.outbox.get(r.id))?.status;
      return { ok: true } as SendResult;
    };
    await sync(send).drain();
    expect(seenStatus).toBe('inflight');
  });

  it('schedules a retry with backoff and keeps the same key', async () => {
    const r = await enqueue(db, { type: 'a', payload: 1 }, clock);
    const send = vi.fn(async () => ({ ok: false, retry: true, reason: 'network' }) as SendResult);
    const report = await sync(send).drain();
    expect(report.retried).toBe(1);
    const stored = await db.outbox.get(r.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.attempt).toBe(1);
    expect(stored?.nextAttemptAt).toBe(clock + 2000); // base * 2^1 with jitter factor 1
    expect(stored?.idempotencyKey).toBe(r.idempotencyKey);
  });

  it('honours Retry-After over the schedule', async () => {
    const r = await enqueue(db, { type: 'a', payload: 1 }, clock);
    const send = async () => ({ ok: false, retry: true, reason: 'rate_limited', retryAfterMs: 30_000 }) as SendResult;
    await sync(send).drain();
    expect((await db.outbox.get(r.id))?.nextAttemptAt).toBe(clock + 30_000);
  });

  it('gives up after the attempt cap', async () => {
    const r = await enqueue(db, { type: 'a', payload: 1 }, clock);
    await db.outbox.update(r.id, { attempt: 7 });
    const send = async () => ({ ok: false, retry: true, reason: 'network' }) as SendResult;
    const report = await sync(send).drain();
    expect(report.failed).toBe(1);
    expect((await db.outbox.get(r.id))?.lastReason).toBe('attempts_exhausted');
  });

  it('a non-retryable failure is failed, not retried', async () => {
    const r = await enqueue(db, { type: 'a', payload: 1 }, clock);
    const send = async () => ({ ok: false, retry: false, reason: 'validation_error' }) as SendResult;
    await sync(send).drain();
    expect((await db.outbox.get(r.id))).toMatchObject({ status: 'failed', lastReason: 'validation_error' });
  });

  it('a version conflict parks the record with the server state', async () => {
    const r = await enqueue(db, { type: 'update', payload: 1, baseVersion: 1 }, clock);
    const send = async () =>
      ({ ok: false, retry: false, reason: 'version_conflict', conflict: { version: 2 } }) as SendResult;
    const report = await sync(send).drain();
    expect(report.conflicted).toBe(1);
    expect((await db.outbox.get(r.id))).toMatchObject({ status: 'conflicted', conflict: { version: 2 } });
  });

  it('a thrown send is treated as retryable', async () => {
    await enqueue(db, { type: 'a', payload: 1 }, clock);
    const send = async () => {
      throw new TypeError('Failed to fetch');
    };
    const report = await sync(send).drain();
    expect(report.retried).toBe(1);
  });
});

describe('forced drain', () => {
  it('a scheduled drain waits for the backoff timer; a forced one does not', async () => {
    const r = await enqueue(db, { type: 'a', payload: 1 }, clock);
    await db.outbox.update(r.id, { attempt: 2, nextAttemptAt: clock + 60_000 });
    const send = vi.fn(async () => ({ ok: true }) as SendResult);
    expect((await sync(send).drain()).sent).toBe(0);
    expect((await sync(send).drain({ force: true })).sent).toBe(1);
  });
});

describe('ordered drain', () => {
  it('stops at the first retryable failure so later intents never overtake', async () => {
    await enqueue(db, { type: 'first', payload: 1 }, clock - 1);
    await enqueue(db, { type: 'second', payload: 2 }, clock);
    const send = vi.fn(async (r: OutboxRecord) =>
      (r.type === 'first' ? { ok: false, retry: true, reason: 'network' } : { ok: true }) as SendResult,
    );
    const report = await sync(send, { ordered: true }).drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ sent: 0, retried: 1 });
  });

  it('continues past a non-retryable failure', async () => {
    await enqueue(db, { type: 'first', payload: 1 }, clock - 1);
    await enqueue(db, { type: 'second', payload: 2 }, clock);
    const send = vi.fn(async (r: OutboxRecord) =>
      (r.type === 'first' ? { ok: false, retry: false, reason: 'insufficient_balance' } : { ok: true }) as SendResult,
    );
    const report = await sync(send, { ordered: true }).drain();
    expect(send).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ sent: 1, failed: 1 });
  });

  it('unordered drain sends everything it can', async () => {
    await enqueue(db, { type: 'first', payload: 1 }, clock - 1);
    await enqueue(db, { type: 'second', payload: 2 }, clock);
    const send = vi.fn(async (r: OutboxRecord) =>
      (r.type === 'first' ? { ok: false, retry: true, reason: 'network' } : { ok: true }) as SendResult,
    );
    const report = await sync(send, { ordered: false }).drain();
    expect(report).toMatchObject({ sent: 1, retried: 1 });
  });
});

describe('web lock', () => {
  it('skips the drain when another tab holds the lock', async () => {
    await enqueue(db, { type: 'a', payload: 1 }, clock);
    const locks = {
      request: async (_name: string, _opts: LockOptions, cb: (lock: Lock | null) => Promise<unknown>) => cb(null),
    } as unknown as LockManager;
    const send = vi.fn();
    const report = await sync(send, { locks }).drain();
    expect(report.skippedLocked).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('runs the drain when the lock is granted', async () => {
    await enqueue(db, { type: 'a', payload: 1 }, clock);
    const locks = {
      request: async (_name: string, _opts: LockOptions, cb: (lock: Lock | null) => Promise<unknown>) =>
        cb({ name: 'test', mode: 'exclusive' }),
    } as unknown as LockManager;
    const send = vi.fn(async () => ({ ok: true }) as SendResult);
    const report = await sync(send, { locks }).drain();
    expect(report.sent).toBe(1);
  });
});

describe('browser events', () => {
  it('the offline event flips the state at once; the online event drains', async () => {
    await enqueue(db, { type: 'a', payload: 1 }, clock);
    const send = vi.fn(async () => ({ ok: true }) as SendResult);
    const s = sync(send, { windowRef: window });
    await s.start();
    expect(s.getState().online).toBe(true);
    window.dispatchEvent(new Event('offline'));
    expect(s.getState().online).toBe(false);
    await enqueue(db, { type: 'b', payload: 2 }, clock);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    s.stop();
  });
});

describe('start', () => {
  it('recovers inflight records and drains once', async () => {
    const r = await enqueue(db, { type: 'a', payload: 1 }, clock);
    await db.outbox.update(r.id, { status: 'inflight' });
    const send = vi.fn(async () => ({ ok: true }) as SendResult);
    const s = sync(send);
    await s.start();
    s.stop();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.outbox.count()).toBe(0);
    expect(s.getState().lastSyncAt).toBe(clock);
  });
});
