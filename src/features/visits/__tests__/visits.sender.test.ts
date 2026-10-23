import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@shared/api/client';
import { FieldkitDb } from '@shared/db/fieldkit-db';

import type { Visit } from '../visits.api';
import { intentId } from '../visits.intents';
import { createVisitLocally } from '../visits.repo';
import { sendVisitIntent, toSendResult } from '../visits.sender';

const api = vi.hoisted(() => ({ createVisit: vi.fn(), getVisit: vi.fn(), updateVisit: vi.fn(), uploadPhoto: vi.fn() }));
vi.mock('../visits.api', () => api);

let db: FieldkitDb;
const now = new Date('2026-10-23T10:00:00Z');
const input = {
  shop_name: 'Shop',
  owner_name: 'Owner',
  phone: '08031234567',
  lat: null,
  lng: null,
  captured_at: now.toISOString(),
  photos: [{ blob: new Blob(['x'], { type: 'image/jpeg' }), width: 10, height: 10 }],
};

function fromServer(id: string, version = 1): Visit {
  return {
    id,
    agent_id: 'ag_1',
    shop_name: 'Shop',
    owner_name: 'Owner',
    phone: '08031234567',
    lat: null,
    lng: null,
    version,
    photo_count: 0,
    captured_at: now.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
}

beforeEach(async () => {
  db = new FieldkitDb(`snd-${crypto.randomUUID()}`);
  await db.open();
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('toSendResult', () => {
  it('maps the server reasons to queue decisions', () => {
    expect(toSendResult(new ApiError({ reason: 'chaos_injected', message: '', status: 500 }))).toMatchObject({ retry: true });
    expect(toSendResult(new ApiError({ reason: 'rate_limited', message: '', status: 429, retryAfterMs: 3000 }))).toMatchObject({ retry: true, retryAfterMs: 3000 });
    expect(toSendResult(new ApiError({ reason: 'validation_error', message: '', status: 400 }))).toMatchObject({ retry: false, reason: 'validation_error' });
    expect(toSendResult(new ApiError({ reason: 'version_conflict', message: '', status: 409, data: { version: 2 } }))).toMatchObject({ retry: false, conflict: { version: 2 } });
    expect(toSendResult(new TypeError('Failed to fetch'))).toMatchObject({ retry: true });
  });
});

describe('sendVisitIntent', () => {
  it('create: posts with the record key and adopts the server version', async () => {
    const v = await createVisitLocally(db, 'ag_1', { ...input, photos: [] }, now);
    api.createVisit.mockResolvedValue(fromServer(v.id, 1));
    const record = (await db.outbox.get(intentId.create(v.id)))!;
    expect(await sendVisitIntent(db, record)).toEqual({ ok: true });
    expect(api.createVisit).toHaveBeenCalledWith(expect.objectContaining({ id: v.id }), record.idempotencyKey);
    expect((await db.visits.get(v.id))!.version).toBe(1);
  });

  it('create: already_exists means the server has it; fetch and finish', async () => {
    const v = await createVisitLocally(db, 'ag_1', { ...input, photos: [] }, now);
    api.createVisit.mockRejectedValue(new ApiError({ reason: 'already_exists', message: '', status: 409 }));
    api.getVisit.mockResolvedValue(fromServer(v.id, 4));
    const record = (await db.outbox.get(intentId.create(v.id)))!;
    expect(await sendVisitIntent(db, record)).toEqual({ ok: true });
    expect((await db.visits.get(v.id))!.version).toBe(4);
  });

  it('photo: a 404 while the visit is still unsent is retried, not failed', async () => {
    const v = await createVisitLocally(db, 'ag_1', input, now);
    api.uploadPhoto.mockRejectedValue(new ApiError({ reason: 'not_found', message: '', status: 404 }));
    const photo = (await db.outbox.toArray()).find((r) => r.type === 'photo.upload')!;
    expect(await sendVisitIntent(db, photo)).toEqual({ ok: false, retry: true, reason: 'visit_not_synced' });
    expect((await db.visits.get(v.id))!.photo_count).toBe(0);
  });

  it('photo: success marks it uploaded and bumps the count', async () => {
    const v = await createVisitLocally(db, 'ag_1', input, now);
    api.uploadPhoto.mockResolvedValue({ id: 'ph_x', visit_id: v.id, bytes: 1, content_hash: 'h', content_type: 'image/jpeg', created_at: now.toISOString() });
    const photo = (await db.outbox.toArray()).find((r) => r.type === 'photo.upload')!;
    expect(await sendVisitIntent(db, photo)).toEqual({ ok: true });
    expect((await db.visits.get(v.id))!.photo_count).toBe(1);
    const [p] = await db.photos.where('visit_id').equals(v.id).toArray();
    expect(p!.uploaded_at).not.toBeNull();
  });

  it('unknown intents are failed, never retried', async () => {
    expect(
      await sendVisitIntent(db, { id: 'x', type: 'nope', payload: null, idempotencyKey: 'k', status: 'inflight', attempt: 0, nextAttemptAt: 0, createdAt: 0, updatedAt: 0 }),
    ).toEqual({ ok: false, retry: false, reason: 'unknown_intent' });
  });
});
