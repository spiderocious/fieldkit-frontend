// Local writes for visits. The UI calls these; they write the device
// database and the outbox in one transaction and return. The network is
// never involved here, which is why the form submits in milliseconds with
// the radio off.
import type { FieldkitDb, LocalPhoto, LocalVisit } from '@shared/db/fieldkit-db';
import { enqueue, putPhoto, type OutboxRecord } from '@shared/offline';

import type { Visit } from './visits.api';
import { INTENT, intentId, type CreateVisitPayload, type UpdateVisitPayload, type UploadPhotoPayload } from './visits.intents';

export interface NewVisitInput {
  shop_name: string;
  owner_name: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  captured_at: string;
  photos: { blob: Blob; width: number; height: number }[];
}

export function newVisitId(): string {
  return `v_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function newPhotoId(): string {
  return `ph_${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Saves a visit and its photos locally and queues their upload. */
export async function createVisitLocally(db: FieldkitDb, agentId: string, input: NewVisitInput, now = new Date()): Promise<LocalVisit> {
  const id = newVisitId();
  const iso = now.toISOString();
  const visit: LocalVisit = {
    id,
    agent_id: agentId,
    shop_name: input.shop_name,
    owner_name: input.owner_name,
    phone: input.phone,
    lat: input.lat,
    lng: input.lng,
    version: 0,
    photo_count: 0,
    captured_at: input.captured_at,
    created_at: iso,
    updated_at: iso,
  };
  const photos: LocalPhoto[] = input.photos.map((p) => ({
    id: newPhotoId(),
    visit_id: id,
    bytes: p.blob.size,
    width: p.width,
    height: p.height,
    uploaded_at: null,
    created_at: iso,
  }));

  // Bytes first: a photo row without bytes is worse than no row.
  for (const [i, p] of photos.entries()) {
    const src = input.photos[i];
    if (src) await putPhoto(db, p.id, src.blob);
  }

  await db.transaction('rw', db.visits, db.photos, db.outbox, async () => {
    await db.visits.put(visit);
    await db.photos.bulkPut(photos);
    const payload: CreateVisitPayload = {
      id,
      shop_name: visit.shop_name,
      owner_name: visit.owner_name,
      phone: visit.phone,
      lat: visit.lat,
      lng: visit.lng,
      captured_at: visit.captured_at,
    };
    const t = now.getTime();
    await enqueue(db, { id: intentId.create(id), type: INTENT.createVisit, payload }, t);
    for (const [i, p] of photos.entries()) {
      const pp: UploadPhotoPayload = { visit_id: id, photo_id: p.id };
      // Later createdAt than the visit, so the drain tries the visit first.
      await enqueue(db, { id: intentId.photo(p.id), type: INTENT.uploadPhoto, payload: pp }, t + 1 + i);
    }
  });
  return visit;
}

export type VisitPatch = Partial<Pick<LocalVisit, 'shop_name' | 'owner_name' | 'phone' | 'lat' | 'lng'>>;

/**
 * Applies an edit locally and queues it. If the visit's create has not been
 * sent yet, the edit folds into that payload: one request, no version
 * dance. Otherwise one update intent per visit carries the latest fields.
 */
export async function updateVisitLocally(db: FieldkitDb, id: string, patch: VisitPatch, now = new Date()): Promise<void> {
  await db.transaction('rw', db.visits, db.outbox, async () => {
    const visit = await db.visits.get(id);
    if (!visit) throw new Error(`visit ${id} not on device`);
    await db.visits.update(id, { ...patch, updated_at: now.toISOString() });

    const create = await db.outbox.get(intentId.create(id));
    if (create && create.type === INTENT.createVisit && create.status !== 'inflight') {
      const payload = { ...(create.payload as CreateVisitPayload), ...patch };
      await db.outbox.update(create.id, { payload, updatedAt: now.getTime() });
      return;
    }

    const existing = await db.outbox.get(intentId.update(id));
    if (existing && existing.status !== 'inflight') {
      const prev = existing.payload as UpdateVisitPayload;
      const payload: UpdateVisitPayload = { visit_id: id, fields: { ...prev.fields, ...patch } };
      await db.outbox.update(existing.id, {
        payload,
        status: 'pending',
        attempt: 0,
        nextAttemptAt: now.getTime(),
        updatedAt: now.getTime(),
        conflict: undefined,
        lastReason: undefined,
      });
      return;
    }
    const payload: UpdateVisitPayload = { visit_id: id, fields: patch };
    await enqueue(db, { id: intentId.update(id), type: INTENT.updateVisit, payload, baseVersion: visit.version }, now.getTime());
  });
}

/**
 * Folds a page of server visits into the device store. A visit with an
 * unsent local change keeps the local copy; the server's version of it will
 * arrive through the sender when the change lands.
 */
export async function mergeServerVisits(db: FieldkitDb, visits: Visit[]): Promise<void> {
  await db.transaction('rw', db.visits, db.outbox, async () => {
    const ids = visits.flatMap((v) => [intentId.create(v.id), intentId.update(v.id)]);
    const pending = await db.outbox.where('id').anyOf(ids).toArray();
    const busy = new Set(pending.map((r) => r.id.replace(/:update$/, '')));
    const rows: LocalVisit[] = visits.filter((v) => !busy.has(v.id)).map((v) => ({ ...v }));
    await db.visits.bulkPut(rows);
  });
}

/** Intent records about one visit, keyed by what they are. */
export interface VisitIntents {
  create?: OutboxRecord;
  update?: OutboxRecord;
  photos: OutboxRecord[];
}

export function intentsFor(visitId: string, records: OutboxRecord[]): VisitIntents {
  const out: VisitIntents = { photos: [] };
  for (const r of records) {
    if (r.id === intentId.create(visitId) && r.type === INTENT.createVisit) out.create = r;
    else if (r.id === intentId.update(visitId)) out.update = r;
    else if (r.type === INTENT.uploadPhoto && (r.payload as UploadPhotoPayload).visit_id === visitId) out.photos.push(r);
  }
  return out;
}

export type VisitSyncState = 'synced' | 'pending' | 'failed' | 'conflicted';

/** One word for the badge, derived from the intents still in the queue. */
export function visitSyncState(intents: VisitIntents): VisitSyncState {
  const all = [intents.create, intents.update, ...intents.photos].filter((r): r is OutboxRecord => r !== undefined);
  if (all.length === 0) return 'synced';
  if (all.some((r) => r.status === 'conflicted')) return 'conflicted';
  if (all.some((r) => r.status === 'failed')) return 'failed';
  return 'pending';
}

/** Resolves a conflict by sending the local fields again against the server's version. */
export async function keepMine(db: FieldkitDb, visitId: string, serverVersion: number, now = new Date()): Promise<void> {
  const r = await db.outbox.get(intentId.update(visitId));
  if (!r) return;
  await db.outbox.update(r.id, {
    baseVersion: serverVersion,
    status: 'pending',
    attempt: 0,
    nextAttemptAt: now.getTime(),
    updatedAt: now.getTime(),
    conflict: undefined,
    lastReason: undefined,
  });
}

/** Resolves a conflict by dropping the local edit and taking the server's record. */
export async function takeTheirs(db: FieldkitDb, visitId: string, server: Visit): Promise<void> {
  await db.transaction('rw', db.visits, db.outbox, async () => {
    await db.outbox.delete(intentId.update(visitId));
    await db.visits.put({ ...server });
  });
}
