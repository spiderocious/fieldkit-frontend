import { beforeEach, describe, expect, it } from 'vitest';

import { OfflineDb } from '../db';
import { enqueue, outboxStats, readyRecords, recoverInflight, resolveConflict, retryNow } from '../outbox';

let db: OfflineDb;

beforeEach(async () => {
  db = new OfflineDb(`test-${crypto.randomUUID()}`);
  await db.open();
});

describe('enqueue', () => {
  it('writes a pending record with a key generated once', async () => {
    const r = await enqueue(db, { type: 'submit-visit', payload: { a: 1 } }, 1000);
    expect(r.status).toBe('pending');
    expect(r.attempt).toBe(0);
    expect(r.idempotencyKey).toMatch(/[0-9a-f-]{36}/);
    expect(r.nextAttemptAt).toBe(1000);
    const stored = await db.outbox.get(r.id);
    expect(stored?.idempotencyKey).toBe(r.idempotencyKey);
  });

  it('accepts a caller-supplied id', async () => {
    const r = await enqueue(db, { id: 'v_01', type: 'submit-visit', payload: {} });
    expect(r.id).toBe('v_01');
  });
});

describe('readyRecords', () => {
  it('returns only records whose time has come, oldest first', async () => {
    await enqueue(db, { type: 'a', payload: {} }, 300);
    await enqueue(db, { type: 'b', payload: {} }, 100);
    const later = await enqueue(db, { type: 'c', payload: {} }, 200);
    await db.outbox.update(later.id, { nextAttemptAt: 10_000 });
    const ready = await readyRecords(db, 500);
    expect(ready.map((r) => r.type)).toEqual(['b', 'a']);
  });
});

describe('recoverInflight', () => {
  it('returns inflight records to pending on start', async () => {
    const r = await enqueue(db, { type: 'a', payload: {} });
    await db.outbox.update(r.id, { status: 'inflight' });
    const n = await recoverInflight(db, 42);
    expect(n).toBe(1);
    const stored = await db.outbox.get(r.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.nextAttemptAt).toBe(42);
  });
});

describe('resolveConflict and retryNow', () => {
  it('re-enqueues with the new base version', async () => {
    const r = await enqueue(db, { type: 'update-visit', payload: { phone: '1' }, baseVersion: 1 });
    await db.outbox.update(r.id, { status: 'conflicted', conflict: { version: 2 } });
    await resolveConflict(db, r.id, { payload: { phone: '1' }, baseVersion: 2 }, 7);
    const stored = await db.outbox.get(r.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.baseVersion).toBe(2);
    expect(stored?.conflict).toBeUndefined();
    expect(stored?.nextAttemptAt).toBe(7);
  });

  it('retryNow resets a failed record', async () => {
    const r = await enqueue(db, { type: 'a', payload: {} });
    await db.outbox.update(r.id, { status: 'failed', attempt: 8, lastReason: 'attempts_exhausted' });
    await retryNow(db, r.id, 9);
    const stored = await db.outbox.get(r.id);
    expect(stored).toMatchObject({ status: 'pending', attempt: 0, nextAttemptAt: 9 });
    expect(stored?.lastReason).toBeUndefined();
  });
});

describe('outboxStats', () => {
  it('computes the five numbers', async () => {
    await enqueue(db, { type: 'a', payload: {} }, 1000);
    const b = await enqueue(db, { type: 'b', payload: {} }, 2000);
    const c = await enqueue(db, { type: 'c', payload: {} }, 3000);
    await db.outbox.update(b.id, { status: 'failed', lastReason: 'validation_error' });
    await db.outbox.update(c.id, { status: 'inflight' });
    const s = await outboxStats(db, 5000);
    expect(s).toMatchObject({ pending: 1, inflight: 1, failed: 1, conflicted: 0 });
    expect(s.failuresByReason).toEqual({ validation_error: 1 });
    expect(s.oldestPendingAgeMs).toBe(4000);
  });

  it('oldest age is null when nothing waits', async () => {
    expect((await outboxStats(db)).oldestPendingAgeMs).toBeNull();
  });
});
