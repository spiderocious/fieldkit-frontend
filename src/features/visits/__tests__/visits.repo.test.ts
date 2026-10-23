import { beforeEach, describe, expect, it } from 'vitest';

import { FieldkitDb } from '@shared/db/fieldkit-db';
import { getPhoto } from '@shared/offline';

import type { Visit } from '../visits.api';
import { INTENT, intentId, type CreateVisitPayload, type UpdateVisitPayload } from '../visits.intents';
import { createVisitLocally, intentsFor, keepMine, mergeServerVisits, takeTheirs, updateVisitLocally, visitSyncState } from '../visits.repo';

let db: FieldkitDb;
const now = new Date('2026-10-23T10:00:00Z');

const input = {
  shop_name: 'Mama Nkechi Provisions',
  owner_name: 'Nkechi Eze',
  phone: '08031234567',
  lat: 7.2571,
  lng: 5.2058,
  captured_at: now.toISOString(),
  photos: [{ blob: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }), width: 1600, height: 1200 }],
};

function serverVisit(id: string, patch: Partial<Visit> = {}): Visit {
  return {
    id,
    agent_id: 'ag_1',
    shop_name: 'Server Shop',
    owner_name: 'Server Owner',
    phone: '08030000000',
    lat: null,
    lng: null,
    version: 1,
    photo_count: 0,
    captured_at: now.toISOString(),
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    ...patch,
  };
}

beforeEach(async () => {
  db = new FieldkitDb(`fk-${crypto.randomUUID()}`);
  await db.open();
});

describe('createVisitLocally', () => {
  it('writes the visit, the photo bytes, and the intents in order', async () => {
    const v = await createVisitLocally(db, 'ag_1', input, now);
    expect(v.id).toMatch(/^v_/);
    expect(v.version).toBe(0);
    expect(await db.visits.get(v.id)).toMatchObject({ shop_name: input.shop_name, agent_id: 'ag_1' });

    const photos = await db.photos.where('visit_id').equals(v.id).toArray();
    expect(photos).toHaveLength(1);
    const blob = await getPhoto(db, photos[0]!.id);
    expect(blob?.size).toBe(10);

    const queue = await db.outbox.orderBy('createdAt').toArray();
    expect(queue.map((r) => r.type)).toEqual([INTENT.createVisit, INTENT.uploadPhoto]);
    expect(queue[0]!.id).toBe(v.id);
    expect((queue[0]!.payload as CreateVisitPayload).captured_at).toBe(input.captured_at);
    expect(visitSyncState(intentsFor(v.id, queue))).toBe('pending');
  });
});

describe('updateVisitLocally', () => {
  it('folds an edit into an unsent create', async () => {
    const v = await createVisitLocally(db, 'ag_1', { ...input, photos: [] }, now);
    await updateVisitLocally(db, v.id, { phone: '08039999999' }, now);
    const create = await db.outbox.get(intentId.create(v.id));
    expect((create!.payload as CreateVisitPayload).phone).toBe('08039999999');
    expect(await db.outbox.get(intentId.update(v.id))).toBeUndefined();
    expect((await db.visits.get(v.id))!.phone).toBe('08039999999');
  });

  it('queues one update with the read version once the visit is on the server', async () => {
    await mergeServerVisits(db, [serverVisit('v_s1', { version: 3 })]);
    await updateVisitLocally(db, 'v_s1', { owner_name: 'New Owner' }, now);
    await updateVisitLocally(db, 'v_s1', { phone: '08030000001' }, now);
    const update = await db.outbox.get(intentId.update('v_s1'));
    expect(update!.baseVersion).toBe(3);
    expect((update!.payload as UpdateVisitPayload).fields).toEqual({ owner_name: 'New Owner', phone: '08030000001' });
    expect(await db.outbox.count()).toBe(1);
  });
});

describe('mergeServerVisits', () => {
  it('keeps a locally edited visit until its change is sent', async () => {
    await mergeServerVisits(db, [serverVisit('v_s1')]);
    await updateVisitLocally(db, 'v_s1', { owner_name: 'Mine' }, now);
    await mergeServerVisits(db, [serverVisit('v_s1', { owner_name: 'Theirs', version: 2 }), serverVisit('v_s2')]);
    expect((await db.visits.get('v_s1'))!.owner_name).toBe('Mine');
    expect(await db.visits.get('v_s2')).toBeDefined();
  });
});

describe('conflicts', () => {
  it('keepMine re-sends against the server version', async () => {
    await mergeServerVisits(db, [serverVisit('v_s1')]);
    await updateVisitLocally(db, 'v_s1', { owner_name: 'Mine' }, now);
    await db.outbox.update(intentId.update('v_s1'), { status: 'conflicted', conflict: serverVisit('v_s1', { version: 2 }) });
    expect(visitSyncState(intentsFor('v_s1', await db.outbox.toArray()))).toBe('conflicted');
    await keepMine(db, 'v_s1', 2, now);
    expect(await db.outbox.get(intentId.update('v_s1'))).toMatchObject({ status: 'pending', baseVersion: 2, attempt: 0 });
  });

  it('takeTheirs drops the edit and adopts the server record', async () => {
    await mergeServerVisits(db, [serverVisit('v_s1')]);
    await updateVisitLocally(db, 'v_s1', { owner_name: 'Mine' }, now);
    await takeTheirs(db, 'v_s1', serverVisit('v_s1', { owner_name: 'Theirs', version: 2 }));
    expect(await db.outbox.get(intentId.update('v_s1'))).toBeUndefined();
    expect(await db.visits.get('v_s1')).toMatchObject({ owner_name: 'Theirs', version: 2 });
  });
});
